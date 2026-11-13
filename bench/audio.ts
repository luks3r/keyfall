// Browser audio hand-off: time from a note command on the main thread to the first rendered block containing it.
// Compares the shared-memory ring with one postMessage per command, in headless Chrome.
//   bun bench/audio.ts [path-to-chrome]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'

const CHROME = process.argv[2] ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = 9333
const STARTUP_MS = 10_000

const server = await createServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname, server: { port: 0, strictPort: false }, logLevel: 'error' })
await server.listen()
const address = server.httpServer!.address()
const page = `http://localhost:${typeof address === 'object' && address ? address.port : 5173}/bench/audio.html`

const profile = mkdtempSync(join(tmpdir(), 'keyfall-bench-'))
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${profile}`,
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  'about:blank',
])

async function target(): Promise<string> {
  const deadline = Date.now() + STARTUP_MS
  while (Date.now() < deadline) {
    try {
      const targets: { type: string; webSocketDebuggerUrl: string }[] = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json()
      const found = targets.find((t) => t.type === 'page')
      if (found) return found.webSocketDebuggerUrl
    } catch {}
    await Bun.sleep(100)
  }
  throw new Error('Chrome did not start')
}

const ws = new WebSocket(await target())
await new Promise((resolve) => (ws.onopen = resolve))
let id = 0
const pending = new Map<number, (result: any) => void>()
ws.onmessage = ({ data }) => {
  const message = JSON.parse(String(data))
  pending.get(message.id)?.(message.result)
}
const call = (method: string, params = {}) =>
  new Promise<any>((resolve) => {
    pending.set(++id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

try {
  await call('Page.enable')
  await call('Page.navigate', { url: page })
  let result
  for (let attempt = 0; attempt < 50 && !result?.result?.value; attempt++) {
    await Bun.sleep(200)
    result = await call('Runtime.evaluate', { expression: 'typeof window.bench === "function" && window.bench()', awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  }
  const { userAgent, output, handOff } = result.result.value
  console.log(userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? userAgent)
  console.log(`output: ${output.sampleRate} Hz, quantum ${output.quantumMs.toFixed(2)} ms, base ${output.baseLatencyMs.toFixed(2)} ms, device ${output.outputLatencyMs.toFixed(2)} ms`)
  for (const r of handOff) console.log(`${r.mode.padEnd(8)} p50 ${r.p50}  p95 ${r.p95}  p99 ${r.p99}  max ${r.max} ms${r.timeouts ? `  (${r.timeouts} timeouts)` : ''}`)
} finally {
  ws.close()
  chrome.kill()
  await server.close()
  rmSync(profile, { recursive: true, force: true })
}
process.exit(0)
