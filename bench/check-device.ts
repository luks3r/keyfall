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
  const legend = () => ev<string[]>("[...document.querySelectorAll('[aria-label=Knobs] > [role=slider]')].map((d) => d.textContent.trim().replace(/\\s+/g, ' '))")
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
  expect('desktop draws the four knobs inside the value cells, beside a mode rail', (await ev("document.querySelectorAll('[aria-label=Knobs] > [role=slider] svg').length")) === 4 && (await ev("document.querySelector('main')?.dataset.layout")) === 'desktop')
  const octaveValue = await center('[aria-label=Knobs] > [aria-label=Octave]')
  if (octaveValue) await dblclick(octaveValue.x, octaveValue.y)
  expect('double-clicking its value on the display resets it too', (await legend())[0] === 'Octave C3' && !(await ev("!!document.querySelector('[role=menu]')")), (await legend())[0])
  const volume = await center('[aria-label=Knobs] > [aria-label=Volume]')
  if (volume) await mouse(volume.x, volume.y)
  expect('tapping a value opens it with a slider', await ev("!!document.querySelector('[role=menu] input[type=range]')"))
  await call('Input.insertText', { text: '55' })
  await key('Enter', 'Enter')
  expect('…and a field to type in', (await legend())[2] === 'Volume 55%' && !(await ev("!!document.querySelector('[role=menu]')")), (await legend())[2])
  if (volume) {
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: volume.x, y: volume.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 6; i++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: volume.x + i * 10, y: volume.y, button: 'left', buttons: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: volume.x + 60, y: volume.y, button: 'left', buttons: 0, clickCount: 1 })
    await Bun.sleep(150)
  }
  expect('dragging a value right turns it up, without opening it', parseInt((await legend())[2].slice(7)) > 55 && !(await ev("!!document.querySelector('[role=menu]')")), (await legend())[2])
  const soundValue = await center('[aria-label=Knobs] > [aria-label=Sound]')
  if (soundValue) await mouse(soundValue.x, soundValue.y)
  expect('tapping a choice lists the choices by group', await ev("[...document.querySelectorAll('[role=menu] div')].some((d) => d.textContent.trim() === 'Keys')"))
  await ev("[...document.querySelectorAll('[role=menuitemradio]')].find((b) => b.textContent.trim() === 'Organ')?.click()")
  await Bun.sleep(150)
  expect('picking one sets it', (await legend())[1] === 'Sound Organ', (await legend())[1])
  expect('desktop docks the piano sound beside the display', await ev("!!document.querySelector('#device-inspector[aria-label=Sound]')"))
  await press('Organ')
  expect('the Sound button folds the docked sound away…', !(await ev("!!document.querySelector('#device-inspector')")))
  await key('KeyI', 'i', ALT)
  expect('…and Alt+I brings it back', await ev("!!document.querySelector('#device-inspector')"))
  await press('Env')
  const attack = await center('#device-inspector [aria-label=Attack]')
  if (attack) await drag(attack.x, attack.y, -40)
  await shot('device-piano-sound.png')
  expect('the piano sound changes as you play', await ev("JSON.parse(localStorage.getItem('keyfall.sound.v1')).draft.attack > 0.008"), await ev("JSON.parse(localStorage.getItem('keyfall.sound.v1')).draft.attack"))
  await key('Slash', '/', MOD)
  expect('⌘/ works with focus in the sound sidebar', await ev("[...document.querySelectorAll('[role=dialog]')].some((e) => e.textContent.includes('Shortcuts') && e.textContent.includes('Settings'))"))
  await key('Escape', 'Escape')
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
  await press('Play')
  await clickButton('1', '[aria-label=Tracks]')
  await clickButton('2', '[aria-label=Tracks]')
  await Bun.sleep(300)
  expect('switching tracks keeps the song playing', await ev("!!document.querySelector('[aria-label=Stop]')"))
  await press('Stop')
  await clickButton('3', '[aria-label=Tracks]')

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
  const length = await center('[aria-label=Knobs] > [aria-label=Steps]')
  if (length) await drag(length.x, length.y, -60)
  expect('dragging the green knob up adds steps', (await legend())[1] !== 'Steps 32 steps' && (await legend())[1]?.startsWith('Steps'), (await legend())[1])
  if (length) await dblclick(length.x, length.y)
  expect('double-click puts the steps back', (await legend())[1] === 'Steps 32 steps', (await legend())[1])

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

  // Speed: the pattern plays slower or faster against the tempo, every note keeping its step.
  const starts = async () => (await notes()).map((n) => n.start).sort((a, b) => a - b)
  const atSpeed1 = await starts()
  const clipLength = async () => (await project()).tracks.at(-1).slots[0].length
  const length1 = await clipLength()
  await key('KeyA', 'a', ALT)
  await key('KeyA', 'a', ALT)
  expect('Speed down twice is half speed', (await legend())[0] === 'Speed ½× · 1/8 steps', (await legend())[0])
  expect('half speed doubles every note and the pattern, steps unchanged', JSON.stringify(await starts()) === JSON.stringify(atSpeed1.map((t) => t * 2)) && (await clipLength()) === length1 * 2 && (await legend())[1] === 'Steps 32 steps', [await starts(), await clipLength(), (await legend())[1]])
  await key('KeyS', 's', ALT)
  expect('Steps sets the count, not tied to bars', (await clipLength()) === length1 * 2 - 0.5, await clipLength())
  await key('KeyW', 'w', ALT)
  await key('KeyQ', 'q', ALT)
  await key('KeyQ', 'q', ALT)
  expect('back to 1× restores the timing', JSON.stringify(await starts()) === JSON.stringify(atSpeed1) && (await clipLength()) === length1, [await starts(), await clipLength()])
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
  expect('Sound opens on the voice: instrument and level', (await legend())[0]?.startsWith('Instrument') && (await legend())[1]?.startsWith('Level'), await legend())
  await press('Filter')
  expect('a section tab puts that section on the knobs', (await legend())[1]?.startsWith('Cutoff'), await legend())
  const cutoff = await center('[aria-label=Knobs] > [aria-label=Cutoff]')
  if (cutoff) await drag(cutoff.x, cutoff.y, -60)
  p = await project()
  expect('turning Cutoff gives the track its own patch with the filter on', !!p.tracks.at(-1).patch?.filter.enabled, (await legend())[1])
  await press('Undo')
  p = await project()
  expect('one undo restores the preset tone', !p.tracks.at(-1).patch)
  await press('Osc')
  await press('+ Oscillator')
  await ev("[...document.querySelectorAll('[aria-label^=Oscillator] [role=radio][aria-label=saw]')].at(-1)?.click()")
  await Bun.sleep(150)
  p = await project()
  const partials = p.tracks.at(-1).patch?.partials ?? []
  expect('oscillators can be added and their wave changed', partials.at(-1)?.wave === 'saw', partials.map((h: { wave: string }) => h.wave))
  expect('the knobs follow the oscillator being edited', (await legend())[0] === 'Wave Saw', await legend())
  const tempoBefore = p.tempo
  const tempo = await center('[aria-label=Tempo]')
  if (tempo) await drag(tempo.x, tempo.y, -40)
  p = await project()
  expect('dragging the tempo changes it', p.tempo > tempoBefore, [tempoBefore, p.tempo])
  if (tempo) await mouse(tempo.x, tempo.y)
  for (let i = 0; i < 4; i++) {
    await ev("[...document.querySelectorAll('[role=menu] button')].find((b) => b.textContent.trim() === 'Tap')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
    await Bun.sleep(500)
  }
  await key('Escape', 'Escape')
  p = await project()
  expect('tapping four beats half a second apart sets 120', Math.abs(p.tempo - 120) <= 2, p.tempo)
  await shot('device-studio-sound.png')
  const bar = await center('[aria-label=Bar]')
  if (bar) await mouse(bar.x, bar.y)
  await ev("[...document.querySelectorAll('[role=menuitemradio]')].find((b) => b.textContent.trim() === '3/4')?.click()")
  await Bun.sleep(150)
  expect('the Bar control sets beats per bar', (await project()).beatsPerBar === 3, (await project()).beatsPerBar)
  if (bar) await mouse(bar.x, bar.y)
  await key('KeyZ', 'z', MOD)
  expect('⌘Z still undoes with a menu open', (await project()).beatsPerBar === 4, (await project()).beatsPerBar)
  await key('Escape', 'Escape')
  await press('Voice')
  const instrument = await center('[aria-label=Knobs] > [aria-label=Instrument]')
  if (instrument) await mouse(instrument.x, instrument.y)
  expect('the instrument list has keys, synths, strings and drums', await ev("['Keys', 'Synth', 'Guitar & strings', 'Drums'].every((g) => [...document.querySelectorAll('[role=menu] div')].some((d) => d.textContent.trim() === g))"))
  await ev("[...document.querySelectorAll('[role=menuitemradio]')].find((b) => b.textContent.trim() === '808 Kit')?.click()")
  await Bun.sleep(150)
  p = await project()
  expect('picking 808 Kit gives the track 808 pads', p.tracks.at(-1).preset === 'kit-808' && p.tracks.at(-1).pads.every((pad: { sample: string }) => pad.sample.includes('kit-808/')), p.tracks.at(-1).preset)

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
  await press('Sound')
  await shot('device-phone-sound.png')
  await press('Pattern')
  await shot('device-phone-pattern.png')
  await press('More')
  await press('Piano')
  await Bun.sleep(400)
  expect('phone: piano fits the width', (await ev<number>('document.documentElement.scrollWidth - innerWidth')) <= 0)
  await shot('device-phone-piano.png')

  // One shell, four shapes: phones upright and sideways (touch), tablet (touch), desktop (mouse).
  const shape = async (width: number, height: number, touch: boolean, mobile = touch) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
    await call('Emulation.setTouchEmulationEnabled', { enabled: touch, maxTouchPoints: touch ? 5 : 1 })
    await Bun.sleep(500)
  }
  const layoutOf = () => ev<string>("document.querySelector('main')?.dataset.layout ?? ''")
  const rectOf = (selector: string) => ev<{ x: number; y: number; w: number; h: number; bottom: number } | null>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom } })()`)
  /** Buttons that stick out of the screen; none is the goal. Scrolled lists may hide rows, so only edges count. */
  const outside = () => ev<string[]>("[...document.querySelectorAll('main button')].filter((b) => { const r = b.getBoundingClientRect(); const scroller = b.closest('[class*=overflow-]'); return r.width && !scroller && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1) }).map((b) => (b.getAttribute('aria-label') ?? b.textContent.trim()).slice(0, 20))")
  const fits = async () => (await ev<boolean>('document.documentElement.scrollWidth <= innerWidth')) && !(await outside()).length

  await shape(390, 844, true)
  expect('phone upright: the piano gives the screen to the keys', (await layoutOf()) === 'upright keys-first' && !(await rectOf('[aria-label=Modes]')), await layoutOf())
  expect('…with octave − / + beside ☰', !!(await rectOf('[aria-label="Octave up"]')))
  await shot('layout-upright-piano.png')
  await press('Show controls')
  expect('☰ slides modes and values down over the notes', !!(await rectOf('#device-panel [aria-label=Modes]')) && !!(await rectOf('#device-panel [aria-label=Knobs]')))
  await shot('layout-upright-piano-panel.png')
  await press('Learn')
  expect('picking a mode closes the panel', !(await rectOf('#device-panel')) && !!(await rectOf('header [aria-label=Play]')))
  await shot('layout-upright-learn.png')
  await press('Show controls')
  await press('Room')
  expect('Room keeps the keys playable under the lobby', (await ev<number>("document.querySelectorAll('section.display canvas').length")) === 1)
  await shot('layout-upright-room.png')
  await press('Show controls')
  await press('Play')
  await press('Show controls')
  await press('Settings')
  await press('Two rows')
  await press('Close')
  await Bun.sleep(300)
  await shot('layout-upright-two-rows.png')
  await press('Show controls')
  await press('Settings')
  await press('One row')
  await press('Close')
  await press('Show controls')
  await press('Studio')
  await Bun.sleep(500)
  expect('phone upright: Studio stacks, with modes along the bottom edge', (await layoutOf()) === 'upright' && Math.abs(((await rectOf('[aria-label=Modes]'))?.bottom ?? 0) - 844) < 40, await rectOf('[aria-label=Modes]'))
  await press('Pattern')
  expect('…and one track chip instead of the track bank', !!(await rectOf('[aria-label^="Track:"]')) && !(await rectOf('[aria-label=Tracks]')))
  expect('…pages show as tabs on the display', !!(await rectOf('[role=radiogroup][aria-label="Pattern pages"]')))
  expect('…keys fold away while editing steps', !!(await rectOf('[aria-label="Show keys"]')) && !(await rectOf('.keys')))
  expect('…everything fits the screen', await fits(), await outside())
  await shot('layout-upright-pattern.png')
  const touch = async (x: number, y: number, to = { x, y }, holdMs = 40) => {
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await Bun.sleep(holdMs)
    for (let i = 1; i <= 6 && (to.x !== x || to.y !== y); i++) {
      await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + ((to.x - x) * i) / 6, y: y + ((to.y - y) * i) / 6 }] })
      await Bun.sleep(16)
    }
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await Bun.sleep(250)
  }
  await press('Steps')
  const emptyPattern = await ev<{ x: number; y: number; w: number; h: number } | null>("(() => { const b = [...document.querySelectorAll('section.display button')].find((b) => b.textContent.includes('is empty')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()")
  if (emptyPattern) await touch(emptyPattern.x + emptyPattern.w / 2, emptyPattern.y + emptyPattern.h / 2)
  const pagesBefore = await ev<string[]>("[...document.querySelectorAll('[aria-label=\"Step pages\"] button')].map((b) => b.textContent.trim())")
  expect('phone steps: fingertip steps in pages of 8', pagesBefore[0] === '1–8', pagesBefore)
  const lastRow = await ev<{ x: number; y: number } | null>("(() => { const r = [...document.querySelectorAll('[aria-label^=\"Step grid\"] [role=row] > div')].at(-1)?.getBoundingClientRect(); return r && { x: r.x, y: r.y + r.height / 2 } })()")
  /** Every note in the project's patterns, to count what a gesture wrote. */
  const current = async () => ((await project()).tracks as { slots: ({ notes: unknown[] } | null)[] }[]).flatMap((t) => t.slots.flatMap((c) => c?.notes ?? []))
  const notesBefore = (await current()).length
  if (lastRow) await touch(lastRow.x + 20, lastRow.y)
  expect('…a tap toggles a step', (await current()).length === notesBefore + 1, [notesBefore, (await current()).length])
  const grid = '[aria-label^="Step grid"]'
  const scrolledBefore = await ev<number>(`document.querySelector(${JSON.stringify(grid)}).parentElement.scrollLeft`)
  if (lastRow) await touch(lastRow.x + 250, lastRow.y, { x: lastRow.x + 40, y: lastRow.y })
  expect('…a swipe scrolls instead of writing', (await ev<number>(`document.querySelector(${JSON.stringify(grid)}).parentElement.scrollLeft`)) > scrolledBefore && (await current()).length === notesBefore + 1)
  await press('Steps 1 to 8')
  await Bun.sleep(400)
  expect('…and the page keys jump back', (await ev<number>(`document.querySelector(${JSON.stringify(grid)}).parentElement.scrollLeft`)) < 5)
  await shot('layout-upright-steps.png')
  for (const mode of ['Perform', 'Song', 'Mix', 'Sound']) {
    await press(mode)
    expect(`phone upright: ${mode} fits the screen`, await fits(), await outside())
    await shot(`layout-upright-${mode.toLowerCase()}.png`)
  }
  await press('Song')
  const timeline = await rectOf('[aria-label="Arrangement timeline"]')
  const toolbar = await rectOf('section.display [aria-label=Actions]')
  expect('phone song: the timeline fills the display down to its toolbar', !!timeline && !!toolbar && Math.abs(toolbar.y - timeline.bottom) < 4, [timeline, toolbar])
  const head = await rectOf('[aria-label^="Track 1:"]')
  expect('…track headers keep to the number', !!head && head.w <= 52, head)
  await ev("document.querySelector('[data-arrangement-clip]')?.click()")
  await Bun.sleep(200)
  const tools = await ev<string[]>("[...document.querySelectorAll('section.display [role=toolbar] button, section.display [aria-label=Actions] button')].map((b) => b.textContent.trim()).filter(Boolean)")
  expect('…a selected clip puts its actions first in the toolbar', tools[0] === 'Edit clip', tools)
  await shot('layout-upright-song.png')
  await press('Pattern')
  await press('Show keys')
  expect('the Keys key opens the drawer', !!(await rectOf('.keys')))
  await press('Hide keys')
  await press('More')
  expect('⋯ holds metronome, bar, redo, Piano and Settings', (await ev<string[]>("[...document.querySelectorAll('[role=menu] button')].map((b) => b.textContent.trim())")).join('|').includes('Metronome'))
  await key('Escape', 'Escape')
  await ev("document.querySelector('[aria-label^=\"Track:\"]')?.click()")
  await Bun.sleep(250)
  expect('the track chip lists every track', (await ev<number>("document.querySelectorAll('[role=menu] [role=menuitemradio]').length")) >= 2)
  await key('Escape', 'Escape')

  await shape(844, 390, true)
  expect('phone sideways: modes on a rail at the left, values in a column', (await layoutOf()) === 'sideways' && ((await rectOf('[aria-label=Modes]'))?.x ?? 99) < 20 && ((await rectOf('[aria-label=Knobs]'))?.x ?? 0) > 600, [await rectOf('[aria-label=Modes]'), await rectOf('[aria-label=Knobs]')])
  expect('…everything fits the screen', await fits(), await outside())
  await shot('layout-sideways-pattern.png')
  await press('Show keys')
  expect('…keys slide over the display without moving it', !!(await rectOf('.keys')))
  await shot('layout-sideways-keys.png')
  await press('Hide keys')

  await shape(820, 1180, true, false)
  expect('tablet: the device stack', (await layoutOf()) === 'tablet' && !!(await rectOf('.keys')) && !!(await rectOf('[aria-label=Tracks]')))
  expect('…everything fits the screen', await fits())
  await shot('layout-tablet-pattern.png')

  await shape(1440, 900, false)
  expect('desktop: mode rail, keys docked', (await layoutOf()) === 'desktop' && ((await rectOf('[aria-label=Modes]'))?.x ?? 99) < 20 && !!(await rectOf('.keys')))
  expect('…everything fits the screen', await fits())
  await shot('layout-desktop-pattern.png')
  expect('desktop: the track sound docks beside Pattern', await ev("!!document.querySelector('#device-inspector[aria-label=\"Track sound\"]')"))
  const knobsBefore = await legend()
  await press('Play')
  const gain = await center('#device-inspector [aria-label=Gain]')
  if (gain) await drag(gain.x, gain.y, -40)
  const shaped = ((await project()).tracks as { patch?: { gain: number } }[]).some((t) => t.patch)
  expect('…a sound is shaped while the pattern plays, without leaving Pattern', shaped && (await ev<boolean>("!!document.querySelector('[aria-label=Stop]')")) && (await ev<string>("document.querySelector('[aria-label=Modes] [aria-pressed=true]')?.textContent.trim() ?? ''")).startsWith('Pattern'), { shaped, gain })
  expect('…and the knobs stay on Pattern', (await legend()).join() === knobsBefore.join(), [knobsBefore, await legend()])
  await press('Stop')
  await shot('layout-desktop-inspector.png')
  await press('Piano')
  await Bun.sleep(400)
  await shot('layout-desktop-piano.png')
  await shape(844, 390, true)
  expect('phone sideways: the piano is keys first too', (await layoutOf()) === 'sideways keys-first')
  await shot('layout-sideways-piano.png')

  expect('no page errors', errors.length === 0, errors.join('\n'))
})

console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
