// End-to-end check of the device UI in headless Chrome: Piano and Studio share one body (strip, display, mode keys,
// four knobs, keyboard). Covers knobs by drag and Alt keys, every Studio mode, launching, sequencing and phones.
//   bun bench/check-device.ts [screenshot-dir]
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withPage, type Page } from './chrome'

const SHOTS = process.argv[2] ?? tmpdir()
const BAR_MS = 2000

let failures = 0
function expect(label: string, ok: unknown, detail: unknown = '') {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

await withPage('/', async ({ call, ev, errors }: Page) => {
  const shot = async (name: string) => Bun.write(join(SHOTS, name), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'))
  const size = async (width: number, height: number, mobile = false) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
    await Bun.sleep(400)
  }
  const key = async (code: string, key: string, modifiers = 0) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key, modifiers })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code, key, modifiers })
    await Bun.sleep(80)
  }
  const press = async (label: string) => {
    const found = await ev<boolean>(`(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)} || b.firstElementChild?.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); b?.click(); return !!b })()`)
    await Bun.sleep(250)
    return found
  }
  const legend = () => ev<string[]>("[...document.querySelectorAll('[aria-label=Knobs] > div')].map((d) => d.textContent.trim().replace(/\\s+/g, ' '))")
  const center = (selector: string, index = 0) =>
    ev<{ x: number; y: number; w: number } | null>(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width } })()`)
  const mouse = async (x: number, y: number, modifiers = 0) => {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers })
    await Bun.sleep(80)
  }
  const drag = async (x: number, y: number, dy: number) => {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 8; i++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: y + (dy * i) / 8, button: 'left', buttons: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y + dy, button: 'left', buttons: 0, clickCount: 1 })
    await Bun.sleep(150)
  }
  const MOD = /Mac/.test(await ev<string>('navigator.userAgent')) ? 4 : 2
  const ALT = 1
  const SHIFT = 8
  const dblclick = async (x: number, y: number) => {
    for (const clickCount of [1, 2]) {
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount })
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount })
    }
    await Bun.sleep(120)
  }
  const rightClick = async (x: number, y: number) => {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', buttons: 2, clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', buttons: 0, clickCount: 1 })
    await Bun.sleep(120)
  }
  /** Real mouse click on a button found by its text, so focus moves the way it does for a person. */
  const clickButton = async (label: string, scope = '') => {
    const at = await ev<{ x: number; y: number } | null>(
      `(() => { const b = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`,
    )
    if (at) await mouse(at.x, at.y)
    await Bun.sleep(150)
    return !!at
  }
  const notes = async () => ((await project()).tracks.at(-1).slots[0]?.notes ?? []) as { pitch: number; start: number; velocity: number }[]
  const project = () => ev("new Promise(r => setTimeout(() => r(JSON.parse(localStorage.getItem('keyfall.project.v1'))), 600))")

  await size(1280, 800)
  await ev("localStorage.clear(); localStorage.setItem('keyfall.settings.v2', JSON.stringify({ audioDelay: 0 })); location.reload()")
  await Bun.sleep(2000)

  // Piano: the front door.
  expect('opens on the piano in Play mode', (await ev("document.querySelector('main')?.getAttribute('aria-label')")) === 'Piano' && (await legend())[0]?.startsWith('Octave'))
  await key('KeyQ', 'q', ALT)
  expect('Alt+Q turns the blue knob one octave up', (await legend())[0] === 'Octave C4', (await legend())[0])
  const octaveKnob = await center('[role=slider][aria-label=Octave]')
  if (octaveKnob) await dblclick(octaveKnob.x, octaveKnob.y)
  expect('double-clicking a knob resets it', (await legend())[0] === 'Octave C3', (await legend())[0])
  await ev("[...document.querySelectorAll('[aria-label=Knobs] button')][2]?.click()")
  await Bun.sleep(150)
  await call('Input.insertText', { text: '55' })
  await key('Enter', 'Enter')
  expect('clicking a knob value lets you type one', (await legend())[2] === 'Volume 55%', (await legend())[2])
  await key('Digit2', '2', ALT)
  expect('Alt+2 presses the second mode key', (await legend())[0]?.startsWith('Speed'), await legend())
  await key('Digit1', '1', ALT)
  await press('Learn')
  expect('Learn puts speed and mode on the knobs', (await legend()).join('|').includes('Speed'), await legend())
  await shot('device-piano-learn.png')

  // Studio.
  await press('Studio')
  await Bun.sleep(600)
  expect('Studio uses the same device body', (await ev("document.querySelector('main')?.getAttribute('aria-label')")) === 'Studio')
  await ev("document.querySelector('[aria-label=\"Add track\"]')?.click()")
  await Bun.sleep(200)

  await press('Pattern')
  const empty = await center('[role=tablist][aria-label^="Patterns"] [aria-selected=true]')
  if (empty) await mouse(empty.x, empty.y)
  await Bun.sleep(300)
  let p = await project()
  const track = p.tracks.at(-1)
  expect('tapping the lit empty pattern creates it', !!track?.slots[0], track?.slots)
  const row = await ev<{ x: number; y: number; w: number } | null>(
    "(() => { const rows = [...document.querySelectorAll('[aria-label^=\"Step grid\"] [role=row] > div')]; const r = rows.at(-1)?.getBoundingClientRect(); return r && { x: r.x, y: r.y + r.height / 2, w: r.width } })()",
  )
  expect('the step grid shows', !!row)
  if (row) for (const i of [0, 4, 8, 12]) await mouse(row.x + ((i + 0.5) * row.w) / 32, row.y)
  p = await project()
  expect('tapping steps writes four notes', p.tracks.at(-1).slots[0]?.notes.length === 4, p.tracks.at(-1).slots[0]?.notes.map((n: { start: number }) => n.start))
  const length = await center('[role=slider][aria-label=Length]')
  if (length) await drag(length.x, length.y, -60)
  expect('dragging the green knob lengthens the pattern', (await legend())[1] !== 'Length 2 bars', (await legend())[1])
  const lengthKnob = await center('[role=slider][aria-label=Length]')
  if (lengthKnob) await dblclick(lengthKnob.x, lengthKnob.y)
  expect('double-click puts the length back', (await legend())[1] === 'Length 2 bars', (await legend())[1])

  // Step grid by mouse: right-click erases, a vertical drag sets velocity.
  if (row) await rightClick(row.x + (12.5 * row.w) / 32, row.y)
  expect('right-click erases a step', (await notes()).length === 3, (await notes()).map((n) => n.start))
  if (row) await drag(row.x + (0.5 * row.w) / 32, row.y, 40)
  const soft = (await notes()).find((n) => n.start === 0)
  expect('dragging a step down makes it softer', !!soft && soft.velocity < 0.8, soft?.velocity)
  await key('KeyZ', 'z', MOD)
  expect('⌘Z undoes the velocity drag', (await notes()).find((n) => n.start === 0)?.velocity === 1, (await notes()).find((n) => n.start === 0)?.velocity)

  // Step input from the computer keyboard right after clicking a soft key with the mouse.
  await clickButton('Step input', '[aria-label=Actions]')
  const before = (await notes()).length
  await key('KeyX', 'x')
  await Bun.sleep(150)
  expect('a clicked soft key leaves the keyboard playing: step input writes a note', (await notes()).length === before + 1, (await notes()).length)
  await key('ArrowRight', 'ArrowRight')
  await key('KeyX', 'x')
  await Bun.sleep(150)
  expect('→ rests a step, then the next note lands after it', (await notes()).some((n) => n.start === 0.5), (await notes()).map((n) => n.start))
  await key('Backspace', 'Backspace')
  await Bun.sleep(150)
  expect('Backspace erases the previous step', !(await notes()).some((n) => n.start === 0.5), (await notes()).map((n) => n.start))
  await key('Escape', 'Escape')
  expect('Escape leaves step input', !(await ev("[...document.querySelectorAll('[aria-label=Actions] button')].some((b) => b.textContent.trim() === 'Rest')")))
  await key('Enter', 'Enter', SHIFT)
  expect('Shift+Enter turns step input on', await ev("[...document.querySelectorAll('[aria-label=Actions] button')].some((b) => b.textContent.trim() === 'Rest')"))
  await key('Escape', 'Escape')

  // Selection, copy and paste on the step grid.
  const actions = () => ev<string[]>("[...document.querySelectorAll('[aria-label=Actions] button')].map((b) => b.textContent.trim())")
  if (row) for (const i of [0, 4]) await mouse(row.x + ((i + 0.5) * row.w) / 32, row.y, SHIFT)
  expect('Shift-click selects steps', (await actions()).includes('Delete 2'), await actions())
  const count = (await notes()).length
  await key('KeyC', 'c', MOD)
  await key('KeyV', 'v', MOD)
  expect('⌘C ⌘V pastes the copy right after the original', (await notes()).length === count + 2 && (await notes()).some((n) => n.start === 1.25), (await notes()).map((n) => n.start))
  await key('Delete', 'Delete')
  expect('Delete removes the selected (pasted) notes', (await notes()).length === count, (await notes()).map((n) => n.start))

  // A note off the grid (1/32 step) is still removed by clicking the 1/16 step it sits in.
  await key('KeyQ', 'q', ALT)
  await key('KeyQ', 'q', ALT)
  const fine = await ev<{ x: number; y: number; w: number }>(
    "(() => { const rows = [...document.querySelectorAll('[aria-label^=\"Step grid\"] [role=row] > div')]; const r = rows.at(-2).getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width } })()",
  )
  await mouse(fine.x + (1.5 * fine.w) / 64, fine.y)
  await key('KeyA', 'a', ALT)
  await key('KeyA', 'a', ALT)
  const offGrid = (await notes()).filter((n) => n.start === 0.125)
  expect('a 1/32 step was drawn', offGrid.length === 1, (await notes()).map((n) => n.start))
  await mouse(fine.x + (0.5 * fine.w) / 32, fine.y)
  expect('clicking the 1/16 step it sits in removes it', !(await notes()).some((n) => n.start === 0.125), (await notes()).map((n) => [n.pitch, n.start]))
  await press('Launch')
  await Bun.sleep(400)
  expect('Launch plays the pattern', await ev("[...document.querySelectorAll('[aria-label=Actions] button')].some((b) => b.textContent.trim() === 'Stop')"))
  await shot('device-studio-pattern.png')

  await press('Perform')
  expect('Perform shows the clip grid with a playing pattern', await ev("!!document.querySelector('[aria-label=\"Clip grid\"] [aria-pressed=true]')"))
  await press('Stop all')
  await Bun.sleep(BAR_MS * 2 + 300)
  expect('Stop all stops on the bar', !(await ev("!!document.querySelector('[aria-label=\"Clip grid\"] [aria-pressed=true]')")))
  await press('Perform')
  const chord = await center('[role=slider][aria-label=Chord]')
  if (chord) for (let i = 0; i < 3; i++) await drag(chord.x, chord.y, -30)
  expect('page 2 puts harmony on the knobs', (await legend())[3]?.startsWith('Chord') && (await legend())[3] !== 'Chord Single notes', (await legend())[3])
  await shot('device-studio-keys.png')

  await press('Sound')
  const filter = await center('[role=slider][aria-label=Filter]')
  if (filter) await drag(filter.x, filter.y, 60)
  p = await project()
  expect('turning Filter gives the track its own patch', !!p.tracks.at(-1).patch, (await legend())[1])
  await press('Undo')
  p = await project()
  expect('one undo restores the preset tone', !p.tracks.at(-1).patch)

  await press('Mix')
  expect('Mix puts track levels on the knobs', (await legend()).filter((l) => /\d+%$/.test(l)).length >= 2, await legend())
  await press('Song')
  expect('Song puts snap and zoom on the knobs', (await legend()).join('|').includes('Snap') && (await legend()).join('|').includes('Zoom'), await legend())
  expect('Song has its project actions', await press('Export MIDI'))
  const clips = async () => ((await project()).tracks as { clips: unknown[] }[]).reduce((sum, t) => sum + t.clips.length, 0)
  const clipCount = await clips()
  await press('New clip')
  await press('Loop clip')
  expect('New clip adds a clip and Loop clip loops it', (await clips()) === clipCount + 1 && (await legend())[3] === 'Loop on', [await clips(), (await legend())[3]])
  await key('Delete', 'Delete')
  expect('Delete removes the selected clip', (await clips()) === clipCount, await clips())
  await key('KeyZ', 'z', MOD)
  await press('Edit clip')
  await press('Song')
  await key('KeyZ', 'z', MOD)
  await key('KeyZ', 'z', MOD)
  await press('Pattern')
  expect('undo under an open song clip keeps the screen working', (await legend()).length === 4 && errors.length === 0, errors.join('\n').slice(0, 300))
  await press('Song')
  await key('Slash', '/', MOD)
  expect('⌘/ opens the shortcuts sheet', await ev("[...document.querySelectorAll('[role=dialog], section, aside')].some((e) => e.textContent.includes('Shortcuts') && e.textContent.includes('Undo'))"))
  await key('Escape', 'Escape')

  await size(390, 844, true)
  for (const mode of ['Perform', 'Pattern', 'Sound', 'Song', 'Mix']) {
    await press(mode)
    const overflow = await ev<number>('document.documentElement.scrollWidth - innerWidth')
    expect(`phone: ${mode} fits the width`, overflow <= 0, overflow)
  }
  await press('Pattern')
  await shot('device-phone-pattern.png')
  await press('Piano')
  await Bun.sleep(400)
  expect('phone: piano fits the width', (await ev<number>('document.documentElement.scrollWidth - innerWidth')) <= 0)
  await shot('device-phone-piano.png')
  expect('no page errors', errors.length === 0, errors.join('\n'))
})

console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
