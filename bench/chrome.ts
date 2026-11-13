// Headless Chrome on the Vite dev server, driven over the DevTools protocol. Used by browser benchmarks and checks.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEBUG_PORT = 9333
const STARTUP_MS = 10_000

export type Page = {
  url: string
  call(method: string, params?: object): Promise<any>
  /** Evaluates `expression` in the page and returns its JSON value. */
  ev<T = any>(expression: string): Promise<T>
  errors: string[]
}

/** Opens `path` (relative to the dev server) and runs `test`; always cleans up Chrome, its profile and the server. */
export async function withPage(path: string, test: (page: Page) => Promise<void>) {
  const server = await createServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname, server: { port: 0, strictPort: false }, logLevel: 'error' })
  await server.listen()
  const address = server.httpServer!.address()
  const url = `http://localhost:${typeof address === 'object' && address ? address.port : 5173}${path}`
  const profile = mkdtempSync(join(tmpdir(), 'keyfall-chrome-'))
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', 'about:blank'])
  let ws: WebSocket | undefined
  try {
    ws = new WebSocket(await target())
    await new Promise((resolve) => (ws!.onopen = resolve))
    let id = 0
    const pending = new Map<number, (result: any) => void>()
    const errors: string[] = []
    ws.onmessage = ({ data }) => {
      const message = JSON.parse(String(data))
      pending.get(message.id)?.(message.result)
      if (message.method === 'Runtime.exceptionThrown') errors.push(String(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text))
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(JSON.stringify(message.params.args.map((a: any) => a.value ?? a.description)))
    }
    const call = (method: string, params = {}) =>
      new Promise<any>((resolve) => {
        pending.set(++id, resolve)
        ws!.send(JSON.stringify({ id, method, params }))
      })
    const ev = async (expression: string) => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }))?.result?.value
    await call('Page.enable')
    await call('Runtime.enable')
    await call('Page.navigate', { url })
    await Bun.sleep(1500)
    await test({ url, call, ev, errors })
  } finally {
    ws?.close()
    chrome.kill()
    await server.close()
    rmSync(profile, { recursive: true, force: true })
  }
}

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
