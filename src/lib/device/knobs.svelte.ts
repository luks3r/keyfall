/**
 * The device's four coloured knobs. Whatever screen is showing decides what they control, as on an OP-1:
 * same knobs, same places, meaning shown in matching colours on the display.
 *
 * Every knob behaves the same way: drag (on the knob or its value on the display; Shift for fine), scroll, arrow
 * keys when focused, Alt + Q/A, W/S, E/D, R/F from anywhere, a MIDI controller knob, and double-click to reset.
 * A tap opens it: a list for choices, a slider, steps and a text field for numbers.
 */

import { nudge, reset, setTo, type KnobSpec } from './knob-specs'

export * from './knob-specs'

export const KNOB_COLORS = ['blue', 'green', 'white', 'orange'] as const
export type KnobColor = (typeof KNOB_COLORS)[number]

/** Alt + these key pairs turn knobs 1–4 up/down, so hands can stay on the keyboard. */
export const KNOB_KEYS: [string, string][] = [
  ['KeyQ', 'KeyA'],
  ['KeyW', 'KeyS'],
  ['KeyE', 'KeyD'],
  ['KeyR', 'KeyF'],
]

class Knobs {
  specs = $state.raw<(KnobSpec | null)[]>([null, null, null, null])
  /** Knob that is open on the display, and the text its field starts with (null: the current value). */
  entering = $state<number | null>(null)
  draft = $state<string | null>(null)
  /** The specs last in use, still known while a screen swaps its specs for new ones. */
  #last: (KnobSpec | null)[] = []

  /** Opens knob `index` on the display: its choices, or its value to set or type. */
  type(index: number, draft: string | null = null) {
    this.draft = draft
    this.entering = index
  }

  /** Lets a screen own the knobs while it is shown; returns the release for `$effect` cleanup. */
  use(specs: (KnobSpec | null)[]) {
    // Screens rebuild their specs as values change; an open knob stays open while it still means the same thing.
    const open = this.entering
    if (open !== null && specs[open]?.label !== this.#last[open]?.label) this.entering = null
    this.specs = this.#last = specs
    return () => {
      if (this.specs === specs) this.specs = [null, null, null, null]
    }
  }

  nudge(index: number, notches: number, fine = false) {
    const spec = this.specs[index]
    if (spec) nudge(spec, notches, fine)
  }

  set(index: number, value: number) {
    const spec = this.specs[index]
    if (spec) setTo(spec, value)
  }

  reset(index: number) {
    const spec = this.specs[index]
    if (spec) reset(spec)
  }

  /** Alt + Q/A, W/S, E/D, R/F; Shift turns finer. Returns true when the key was a knob key. */
  key(e: KeyboardEvent): boolean {
    if (!e.altKey || e.metaKey || e.ctrlKey) return false
    const index = KNOB_KEYS.findIndex((pair) => pair.includes(e.code))
    if (index < 0) return false
    e.preventDefault()
    this.nudge(index, KNOB_KEYS[index][0] === e.code ? 1 : -1, e.shiftKey)
    return true
  }
}

export const knobs = new Knobs()
