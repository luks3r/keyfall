// End-to-end check of the live Studio in headless Chrome: session clips, launch quantization, keyboard launch mode,
// loop recording and drum pads. Screenshots go to the directory given as the first argument (default: tmp).
//   bun bench/check-studio.ts [screenshot-dir]
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withPage, type Page } from './chrome'

const SHOTS = process.argv[2] ?? tmpdir()
const SLOTS = "[aria-label=Session] button[aria-label^='Launch clip'], [aria-label=Session] button[aria-label^='Stop Track'], [aria-label=Session] button[aria-label^='Stop Drums']"
const BAR_MS = 2000

let failures = 0
function expect(label: string, ok: boolean, detail: unknown = '') {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

await withPage('/', async ({ call, ev, errors }: Page) => {
  const shot = async (name: string) => Bun.write(join(SHOTS, name), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'))
  const key = async (code: string, key: string) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code, key })
  }
  const mouse = async (x: number, y: number, button: 'left' | 'right' = 'left') => {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : 2, clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 })
  }
  const center = (selector: string, index = 0) =>
    ev<{ x: number; y: number } | null>(
      `(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
  const active = (index: number) => ev<string>(`document.querySelectorAll(${JSON.stringify(SLOTS)})[${index}]?.getAttribute('aria-pressed')`)
  const project = () => ev("new Promise(r => setTimeout(() => r(JSON.parse(localStorage.getItem('keyfall.project.v1'))), 600))")

  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await ev("localStorage.clear(); localStorage.setItem('keyfall.settings.v2', JSON.stringify({ workspace: 'studio', audioDelay: 0 })); location.reload()")
  await Bun.sleep(2000)
  expect('session grid shows 8 scenes', (await ev("document.querySelectorAll('[aria-label^=\"Launch scene\"]').length")) === 8)

  const first = (await center(SLOTS, 0))!
  const plus = await center('[aria-label="New clip"]')
  expect('the selected empty slot offers a new clip', !!plus)
  if (plus) await mouse(plus.x, plus.y)
  await Bun.sleep(300)
  let p = await project()
  expect('new slot clip is 2 bars', p.tracks[0].slots[0]?.length === 8, p.tracks[0].slots[0]?.length)

  await mouse(first.x, first.y, 'right')
  await Bun.sleep(400)
  await ev("[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Notes')?.click()")
  await Bun.sleep(300)
  const grid = await ev<{ x: number; sy: number; sh: number } | null>(
    "(() => { const g = document.querySelector('[aria-label=\"Note grid\"] .relative.flex > div:nth-child(2)'); if (!g) return null; const r = g.getBoundingClientRect(); const s = document.querySelector('[aria-label=\"Note grid\"]').getBoundingClientRect(); return { x: r.x, sy: s.y, sh: s.height } })()",
  )
  expect('the clip opens in the piano roll', !!grid)
  if (grid) for (let i = 0; i < 4; i++) await mouse(grid.x + 6 + i * 96, grid.sy + grid.sh / 2 - i * 14)
  p = await project()
  expect('notes added to the slot clip', p.tracks[0].slots[0].notes.length === 4, p.tracks[0].slots[0].notes.length)

  await mouse(first.x, first.y)
  await Bun.sleep(400)
  expect('launching while stopped starts at once', (await active(0)) === 'true')
  await shot('live-session.png')

  await key('Tab', 'Tab')
  await Bun.sleep(200)
  expect('launch mode shows key hints', await ev("[...document.querySelectorAll('[aria-label=Session] button span')].some(s => s.textContent === '1')"))
  await key('Escape', 'Escape')
  await Bun.sleep(150)
  expect('stop waits for the bar', (await active(0)) === 'true')
  await Bun.sleep(BAR_MS + 300)
  expect('clip stopped on the bar', (await active(0)) === 'false')
  await key('Digit1', '1')
  await Bun.sleep(300)
  expect('key 1 queues the clip for the bar', (await active(0)) === 'false')
  await Bun.sleep(BAR_MS)
  expect('key 1 relaunched the clip on the bar', (await active(0)) === 'true')
  await key('Tab', 'Tab')

  const second = (await center(SLOTS, 1))!
  await mouse(second.x, second.y)
  await Bun.sleep(200)
  await key('Enter', 'Enter')
  const started = performance.now()
  while ((await active(1)) !== 'true' && performance.now() - started < BAR_MS * 2) await Bun.sleep(50)
  expect('loop recording launches on the next bar', (await active(1)) === 'true', `${Math.round(performance.now() - started)} ms`)
  for (const [code, k] of [['KeyZ', 'z'], ['KeyC', 'c'], ['KeyB', 'b'], ['KeyQ', 'q']]) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k })
    await Bun.sleep(150)
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k })
    await Bun.sleep(350)
  }
  await key('Enter', 'Enter')
  p = await project()
  const recorded = p.tracks[0].slots[1]
  expect(
    'played notes land in the loop one beat apart',
    recorded?.notes.length === 4,
    recorded?.notes.map((n: { pitch: number; start: number }) => `${n.pitch}@${n.start.toFixed(2)}`).join(' '),
  )

  // Keyboard playing: triads in C major, entered into the slot clip with step input.
  await ev(`(() => {
    const set = (select, value) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) }
    const selects = [...document.querySelectorAll('[aria-label=Play] select')]
    set(selects.find((s) => [...s.options].some((o) => o.value === 'major')), 'major')
    set(selects.find((s) => [...s.options].some((o) => o.value === 'triad')), 'triad')
  })()`)
  await mouse(first.x, first.y, 'right')
  await Bun.sleep(400)
  expect('long press opens the step sequencer', !!(await ev("document.querySelector('[aria-label=\"Step grid\"]')")))
  await ev("document.querySelector('[aria-label=\"Clear all notes\"]')?.click()")
  await ev("document.querySelector('[aria-label^=\"Step input\"]')?.click()")
  await Bun.sleep(200)
  for (const [code, k] of [['KeyZ', 'z'], ['KeyX', 'x'], ['KeyC', 'c']]) {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k })
    await Bun.sleep(60)
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k })
    await Bun.sleep(60)
  }
  p = await project()
  const stepped = p.tracks[0].slots[0].notes
    .map((n: { pitch: number; start: number }) => [n.start, n.pitch])
    .sort((a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1])
  expect(
    'step input writes diatonic triads one step apart',
    JSON.stringify(stepped) === JSON.stringify([[0, 48], [0, 52], [0, 55], [0.25, 50], [0.25, 53], [0.25, 57], [0.5, 52], [0.5, 55], [0.5, 59]]),
    stepped,
  )
  await ev("document.querySelector('[aria-label^=\"Step input\"]')?.click()")
  await shot('live-steps.png')

  await ev("document.querySelector('[aria-label=\"Add drum track\"]')?.click()")
  await Bun.sleep(300)
  await ev("[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Pads')?.click()")
  await Bun.sleep(500)
  expect('drum track has 16 pads', (await ev("document.querySelectorAll('[aria-label=\"bottom panels\"] button.touch-none').length")) === 16)
  await shot('live-pads.png')
  await ev("[...document.querySelectorAll('[role=tab]')].find(t => t.textContent === 'Steps')?.click()")
  const newClip = await center('[aria-label="New clip"]')
  if (newClip) await mouse(newClip.x, newClip.y)
  await Bun.sleep(300)
  const kick = await ev<{ x: number; y: number; step: number } | null>(
    "(() => { const row = document.querySelector('[aria-label=\"Kick steps\"]'); if (!row) return null; const r = row.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, step: r.width / 32 } })()",
  )
  expect('drum clip shows named pad rows', !!kick)
  if (kick) for (const i of [0, 4, 8, 12]) await mouse(kick.x + (i + 0.5) * kick.step, kick.y)
  p = await project()
  const drumClip = p.tracks.at(-1).slots.find(Boolean)
  expect('tapping steps writes a four-on-the-floor kick', drumClip?.notes.filter((n: { pitch: number }) => n.pitch === 36).length === 4, drumClip?.notes.map((n: { start: number }) => n.start))
  await key('Space', ' ')

  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await Bun.sleep(600)
  await shot('live-phone.png')
  expect('no page errors', errors.length === 0, errors.join('\n'))
})

console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
