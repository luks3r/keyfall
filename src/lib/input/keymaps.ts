export type KeyLayout = Record<string, number>
export type KeymapPreset = { id: string; name: string; description: string; keys: KeyLayout }
/** `shifted`: Shift selects a second layer (`Shift+Code` entries), so the pedal moves to `sustain`. */
export type Keymap = { keys: Map<string, number>; codes: Map<number, string>; lo: number; hi: number; shifted: boolean; sustain: Set<string> }

/** Prefix of a binding played with Shift held. */
export const SHIFT = 'Shift+'

const WHITE_STEPS = [0, 2, 4, 5, 7, 9, 11]
const HAS_SHARP = [true, true, false, true, true, true, false]

const chromatic = (codes: string[], start: number): KeyLayout =>
  Object.fromEntries(codes.map((code, i) => [code, start + i]))

const whites = (codes: string[], start: number): KeyLayout =>
  Object.fromEntries(codes.map((code, i) => [code, start + 12 * Math.floor(i / 7) + WHITE_STEPS[i % 7]]))

/** White keys on `codes`; Shift on a white key plays the black key above it. */
const shiftSharps = (codes: string[], start: number): KeyLayout =>
  Object.fromEntries(
    codes.flatMap((code, i) => {
      const offset = start + 12 * Math.floor(i / 7) + WHITE_STEPS[i % 7]
      return HAS_SHARP[i % 7] && i < codes.length - 1 ? [[code, offset], [SHIFT + code, offset + 1]] : [[code, offset]]
    }),
  )

/** Piano-shaped pair of rows: `whites` on one row, `blacks` on the row above, sitting between the whites they split. */
const pianoRows = (whites: string[], blacks: (string | null)[], start: number, firstStep = 0): KeyLayout => {
  const layout: KeyLayout = {}
  whites.forEach((code, i) => {
    const step = firstStep + i
    const offset = start + 12 * Math.floor(step / 7) + WHITE_STEPS[step % 7] - WHITE_STEPS[firstStep]
    layout[code] = offset
    const black = blacks[i]
    if (black && HAS_SHARP[step % 7]) layout[black] = offset + 1
  })
  return layout
}

const isomorphic = (rows: string[][], rowStep: number, columnStep: number): KeyLayout =>
  Object.fromEntries(rows.flatMap((row, r) => row.map((code, i) => [code, r * rowStep + i * columnStep])))

const DIGIT_ROW = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal']
const Q_ROW = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight']
const A_ROW = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote']
const Z_ROW = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash']
const ROWS_BOTTOM_UP = [Z_ROW, A_ROW, Q_ROW, DIGIT_ROW]

const TRACKER_LOWER = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash']
const TRACKER_UPPER = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP', 'BracketLeft', 'Equal', 'BracketRight']

/**
 * Each hand gets its own half of the keyboard and two piano-shaped row pairs: white keys on the Z and Q rows,
 * black keys on the row above, physically between the white keys they split. The bottom pair continues into
 * the top pair, so a hand covers C–E (left, 17 keys) or C–G (right, 20 keys) without crossing the other hand.
 */
const RIGHT_HAND = 24
const TWO_HANDS: KeyLayout = {
  ...pianoRows(['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'], ['KeyS', 'KeyD', null, 'KeyG', 'KeyH'], 0),
  ...pianoRows(['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT'], ['Digit2', null, 'Digit4', 'Digit5'], 9, 5),
  ...pianoRows(['KeyN', 'KeyM', 'Comma', 'Period', 'Slash'], ['KeyJ', 'KeyK', null, 'Semicolon', 'Quote'], RIGHT_HAND),
  ...pianoRows(['KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'], ['Digit7', null, 'Digit9', 'Digit0', null, 'Equal'], RIGHT_HAND + 9, 5),
}

/** 36 white keys from 1 to M, the layout used by Virtual Piano sheets. */
const VIRTUAL_PIANO_WHITES = [...DIGIT_ROW.slice(0, 10), ...Q_ROW.slice(0, 10), ...A_ROW.slice(0, 9), ...Z_ROW.slice(0, 7)]

export const KEYMAPS: KeymapPreset[] = [
  {
    id: 'hands',
    name: 'Two hands · split',
    description: 'Left hand on the left half, right hand on the right, each on its own piano-shaped rows. Bass and melody two octaves apart, no crossing.',
    keys: TWO_HANDS,
  },
  {
    id: 'virtual',
    name: 'Virtual Piano · 61 keys',
    description: 'White keys run 1 → M, Shift plays the sharp. Five octaves; reads Virtual Piano sheets as written. Sustain moves to `.',
    keys: shiftSharps(VIRTUAL_PIANO_WHITES, 0),
  },
  {
    id: 'tracker',
    name: 'Tracker · 2 rows',
    description: 'Two piano-shaped rows an octave apart, as in trackers and VMPK. One hand, easy to read.',
    keys: { ...chromatic(TRACKER_LOWER, 0), ...chromatic(TRACKER_UPPER, 12) },
  },
  {
    id: 'daw',
    name: 'DAW · home row',
    description: 'One and a half octaves on the home row, black keys above. Matches most DAWs.',
    keys: chromatic(['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'], 0),
  },
  {
    id: 'accordion',
    name: 'Accordion · C-system',
    description: 'Chromatic button-accordion grid: +3 semitones per key, +1 per row. Three full octaves, wide chords under one hand.',
    keys: isomorphic(ROWS_BOTTOM_UP, 1, 3),
  },
  {
    id: 'wicki',
    name: 'Isomorphic · Wicki-Hayden',
    description: 'Whole tones across, fourths per row. Every chord and scale has the same shape in every key.',
    keys: isomorphic(ROWS_BOTTOM_UP, 5, 2),
  },
]

const SHIFT_KEYS = ['ShiftLeft', 'ShiftRight']
/** Pedal for layouts that use Shift as a note layer. */
const LAYER_SUSTAIN = 'Backquote'
export const RESERVED = new Set(['Space', 'Escape', 'Tab', 'Enter', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ...SHIFT_KEYS])

export function compile(layout: KeyLayout): Keymap {
  const shifted = Object.keys(layout).some((code) => code.startsWith(SHIFT))
  const sustain = new Set(shifted ? [LAYER_SUSTAIN] : SHIFT_KEYS)
  const keys = new Map(Object.entries(layout).filter(([code]) => !RESERVED.has(code) && !sustain.has(code)))
  const codes = new Map<number, string>()
  for (const [code, offset] of keys) if (!codes.has(offset) || codes.get(offset)!.startsWith(SHIFT)) codes.set(offset, code)
  const offsets = [...codes.keys()]
  return {
    keys,
    codes,
    lo: offsets.length ? Math.min(...offsets) : 0,
    hi: offsets.length ? Math.max(...offsets) : 0,
    shifted,
    sustain,
  }
}

/** The binding a key press selects: the Shift layer first when the layout has one. */
export function lookup(keymap: Keymap, code: string, shift: boolean): number | undefined {
  return (shift && keymap.shifted ? keymap.keys.get(SHIFT + code) : undefined) ?? keymap.keys.get(code)
}

const SYMBOLS: Record<string, string> = {
  Comma: ',', Period: '.', Semicolon: ';', Slash: '/', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Equal: '=', Minus: '-', Backquote: '`', Backslash: '\\', IntlBackslash: '\\',
}

type LayoutMap = { get(code: string): string | undefined }
type KeyboardApi = { getLayoutMap(): Promise<LayoutMap> }

let layoutMap: LayoutMap | undefined

export async function localizeLabels() {
  const keyboard = (navigator as Navigator & { keyboard?: KeyboardApi }).keyboard
  layoutMap = await keyboard?.getLayoutMap().catch(() => undefined)
}

export const symbol = (code: string): string =>
  code.startsWith(SHIFT)
    ? `⇧${symbol(code.slice(SHIFT.length))}`
    : (layoutMap?.get(code)?.toUpperCase() ?? SYMBOLS[code] ?? code.replace(/^(Key|Digit|Numpad)/, ''))

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

export const noteName = (midi: number) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
