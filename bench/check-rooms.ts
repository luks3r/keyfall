// Rooms end to end: three players in separate browser profiles, a site server that serves the app and a
// rooms-only server elsewhere. Covers the lobby, adding and removing servers, starting a room, joining from the
// list, from an invite and by typing a code that lives on another server.
//   bun run check:rooms [screenshot-dir]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const SHOTS = process.argv[2]
const SITE = 7790
const ROOMS = 7791
const binary = new URL('../target/release/keyfall-room', import.meta.url).pathname
const dist = new URL('../dist', import.meta.url).pathname
const servers = [
  spawn(binary, ['--port', String(SITE), '--static', dist, '--name', 'Site server']),
  spawn(binary, ['--port', String(ROOMS), '--app', `http://localhost:${SITE}`, '--name', 'Second server']),
]
const profile = mkdtempSync(join(tmpdir(), 'kf-rooms-'))
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9337', `--user-data-dir=${profile}`, '--no-first-run', 'about:blank'])
let failures = 0
const expect = (label: string, ok: unknown, detail: unknown = '') => { if (!ok) failures++; console.log(`${ok ? '✓' : '✗'} ${label}${detail === '' ? '' : ` — ${JSON.stringify(detail)}`}`) }
try {
  for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:9337/json/version'); await fetch(`http://localhost:${ROOMS}/health`); break } catch { await Bun.sleep(200) } }
  const version = await (await fetch('http://127.0.0.1:9337/json/version')).json()
  const browser = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((r) => (browser.onopen = r))
  let bid = 0
  const bpending = new Map<number, (v: any) => void>()
  browser.onmessage = ({ data }) => { const m = JSON.parse(String(data)); bpending.get(m.id)?.(m.result) }
  const bcall = (method: string, params = {}) => new Promise<any>((r) => { const i = ++bid; bpending.set(i, r); browser.send(JSON.stringify({ id: i, method, params })) })

  /** A player in their own browser profile (separate storage). */
  async function person(url: string) {
    const { browserContextId } = await bcall('Target.createBrowserContext')
    const { targetId } = await bcall('Target.createTarget', { url: 'about:blank', browserContextId })
    const list = await (await fetch('http://127.0.0.1:9337/json/list')).json()
    const ws = new WebSocket(list.find((t: any) => t.id === targetId).webSocketDebuggerUrl)
    await new Promise((r) => (ws.onopen = r))
    let id = 0
    const pending = new Map<number, (v: any) => void>()
    ws.onmessage = ({ data }) => { const m = JSON.parse(String(data)); pending.get(m.id)?.(m.result) }
    const call = (method: string, params = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
    const ev = async (expression: string) => (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value
    await call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false })
    await call('Page.navigate', { url })
    await Bun.sleep(2500)
    const click = async (label: string) => { const ok = await ev(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} || b.textContent.trim().startsWith(${JSON.stringify(label)})); b?.click(); return !!b })()`); await Bun.sleep(400); return ok }
    const type = async (selector: string, text: string) => { await ev(`(() => { const i = document.querySelector(${JSON.stringify(selector)}); i.focus(); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })) })()`); await call('Input.insertText', { text }); await Bun.sleep(300) }
    const text = () => ev('document.querySelector("main [aria-label$=display]").innerText')
    const shot = async (name: string) => SHOTS && Bun.write(join(SHOTS, name), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'))
    return { ev, click, type, text, shot, call }
  }

  const ana = await person(`http://localhost:${SITE}/`)
  await ana.click('Room'); await Bun.sleep(1500)
  expect('lobby greets and offers a code box', (await ana.text()).includes('Got a code?'), (await ana.text()).slice(0, 120))
  expect('lobby says the room list is empty', (await ana.text()).includes('No rooms open right now'))
  await ana.shot('rooms-lobby-empty.png')

  await ana.click('Servers')
  await ana.type('[aria-label="Server address"]', `localhost:${ROOMS}`)
  await ana.click('Add'); await Bun.sleep(1500)
  expect('adding a server checks it and names it', (await ana.text()).includes('Added Second server'), (await ana.text()))
  await ana.shot('rooms-servers.png')
  await ana.ev(`[...document.querySelectorAll('[aria-label=Servers] button')].find(b => b.textContent.includes('Second server')).click()`); await Bun.sleep(300)
  expect('tapping a server makes new rooms go there', (await ana.text()).match(/Second server[^\n]*\n[^\n]*new rooms go here/) !== null, await ana.text())
  await ana.click('Back')
  await ana.click('Start a room')
  await ana.shot('rooms-new.png')
  await ana.click('Start room'); await Bun.sleep(1500)
  const code = await ana.ev(`document.querySelector('[aria-label^="Room code"]')?.textContent.trim()`)
  expect('starting a room shows its code big', /^[A-Z0-9]{5}$/.test(code ?? ''), code)
  await ana.shot('rooms-inside.png')

  // Ben only knows the site server: the code isn't found, and his chosen server stays put.
  const ben = await person(`http://localhost:${SITE}/`)
  await ben.click('Room'); await Bun.sleep(1500)
  await ben.type('[aria-label="Room code"]', code); await Bun.sleep(2500)
  expect('a code on an unknown server says so plainly', (await ben.text()).includes('No room with that code'), (await ben.text()).slice(0, 200))

  // Cleo adds the second server by pasting Ana's invite link, sees the room, and taps it.
  const link = `http://localhost:${SITE}/?server=${encodeURIComponent(`localhost:${ROOMS}`)}#room=${code}`
  const cleo = await person(`http://localhost:${SITE}/`)
  await cleo.click('Room'); await Bun.sleep(1000)
  await cleo.click('Servers')
  await cleo.type('[aria-label="Server address"]', link)
  await cleo.click('Add'); await Bun.sleep(1500)
  expect('pasting an invite link adds its server', (await cleo.text()).includes('Added Second server'), (await cleo.text()).slice(0, 300))
  await cleo.click('Back'); await Bun.sleep(1500)
  expect("the other server's room shows in the lobby", (await cleo.text()).includes(`${'Player'}`) || (await cleo.text()).includes("'s room"), (await cleo.text()).slice(0, 300))
  await cleo.shot('rooms-lobby.png')
  await cleo.ev(`[...document.querySelectorAll('button')].find(b => b.textContent.includes("'s room") && b.textContent.includes('Join'))?.click()`); await Bun.sleep(1500)
  expect('tapping a room card joins it', /in the room · 2/i.test(await cleo.text()), (await cleo.text()).slice(0, 200))

  // Ben opens the invite link: he's asked once, joins, and now knows the server too.
  const ben2 = await person(link)
  await ben2.click('Room'); await Bun.sleep(1500)
  expect('an invite offers one big Join button', (await ben2.text()).includes(`invited to room ${code}`), (await ben2.text()).slice(0, 200))
  await ben2.click('Join as'); await Bun.sleep(1500)
  expect('joining from an invite works', /in the room · 3/i.test(await ben2.text()), (await ben2.text()).slice(0, 200))
  expect('the address bar loses ?server=', !(await ben2.ev('location.search')), await ben2.ev('location.href'))

  // Typing the code finds it on whichever known server has it.
  await cleo.click('Leave'); await Bun.sleep(800)
  await cleo.ev(`(() => { localStorage.setItem('keyfall.room.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('keyfall.room.v1')), server: '' })) })()`)
  await cleo.call('Page.reload'); await Bun.sleep(2500)
  await cleo.click('Room'); await Bun.sleep(1500)
  await cleo.type('[aria-label="Room code"]', code); await Bun.sleep(1500)
  expect('a typed code is found on another known server and shown before joining', (await cleo.text()).includes('Found it!'), (await cleo.text()).slice(0, 300))
  await cleo.ev(`document.querySelector('[aria-label="Rooms with this code"] button').click()`); await Bun.sleep(1500)
  expect('confirming joins it', /in the room · 3/i.test(await cleo.text()), (await cleo.text()).slice(0, 200))

  // The same code on two servers (here: one server under two addresses) asks which one.
  await cleo.click('Leave'); await Bun.sleep(500)
  await cleo.click('Servers')
  await cleo.type('[aria-label="Server address"]', `127.0.0.1:${ROOMS}`)
  await cleo.click('Add'); await Bun.sleep(1200)
  await cleo.click('Back')
  await cleo.type('[aria-label="Room code"]', code); await Bun.sleep(1500)
  expect('a code in two places asks which one', (await cleo.text()).includes(`Code ${code} is in 2 places`), (await cleo.text()).slice(0, 300))
  await cleo.shot('rooms-which-one.png')
  await cleo.ev(`document.querySelectorAll('[aria-label="Rooms with this code"] button')[1].click()`); await Bun.sleep(1500)
  expect('picking one joins it', /in the room · 3/i.test(await cleo.text()), (await cleo.text()).slice(0, 200))
  await cleo.click('Leave'); await Bun.sleep(500)
  await cleo.click('Servers')
  for (let i = 0; i < 2; i++) {
    await cleo.ev(`document.querySelector('[aria-label="Remove Second server"]').click()`); await Bun.sleep(200)
    await cleo.click('Remove'); await Bun.sleep(500)
  }
  expect('removing a server takes two taps and drops it', !(await cleo.text()).includes('Second server'), (await cleo.text()).slice(0, 300))
} finally {
  chrome.kill()
  for (const server of servers) server.kill()
  rmSync(profile, { recursive: true, force: true })
}
console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
