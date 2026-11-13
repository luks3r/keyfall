/**
 * The device's four coloured knobs. Whatever screen is showing decides what they control, as on an OP-1:
 * same knobs, same places, meaning shown in matching colours on the display.
 *
 * Every knob behaves the same way: drag up/down (Shift for fine), scroll, arrow keys when focused, Alt + Q/A,
 * W/S, E/D, R/F from anywhere, a MIDI controller knob, double-click (or Delete) to reset, and Enter or a click on
 * its value to type one.
 */

import type { KnobSpec } from './knob-specs'

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
const NUDGE = 1 / 50
const FINE = 1 / 4
/** PageUp / PageDown move this many notches. */
export const KNOB_COARSE = 10

const clamp = (value: number) => Math.max(0, Math.min(1, value))

class Knobs {
  specs = $state.raw<(KnobSpec | null)[]>([null, null, null, null])
  /** Knob whose value is being typed on the display, and the text it starts with (null: the current value). */
  entering = $state<number | null>(null)
  draft = $state<string | null>(null)

  /** Opens value entry on the display for knob `index`. */
  type(index: number, draft: string | null = null) {
    this.draft = draft
    this.entering = index
  }

  /** Lets a screen own the knobs while it is shown; returns the release for `$effect` cleanup. */
  use(specs: (KnobSpec | null)[]) {
    this.specs = specs
    this.entering = null
    return () => {
      if (this.specs === specs) this.specs = [null, null, null, null]
    }
  }

  /** Continuous turn from a drag, in 0–1 units. Discrete knobs use `nudge`. */
  turn(index: number, delta: number) {
    const spec = this.specs[index]
    if (spec && delta) spec.set(clamp(spec.value() + delta))
  }

  /** Arrow press or wheel notch: one choice on discrete knobs, `nudge` on the rest. */
  nudge(index: number, notches: number, fine = false) {
    const spec = this.specs[index]
    if (!spec || !notches) return
    if (spec.steps) {
      const choice = Math.round(spec.value() * (spec.steps - 1)) + Math.sign(notches) * Math.max(1, Math.round(Math.abs(notches)))
      spec.set(clamp(choice / (spec.steps - 1)))
    } else {
      spec.set(clamp(spec.value() + notches * (spec.nudge ?? NUDGE) * (fine ? FINE : 1)))
    }
  }

  set(index: number, value: number) {
    const spec = this.specs[index]
    if (!spec) return
    spec.set(spec.steps ? Math.round(clamp(value) * (spec.steps - 1)) / (spec.steps - 1) : clamp(value))
  }

  reset(index: number) {
    const spec = this.specs[index]
    if (spec?.initial !== undefined) this.set(index, spec.initial)
  }

  /** Applies typed text; returns false when the knob can't read it. */
  enter(index: number, text: string) {
    const value = this.specs[index]?.parse?.(text.trim())
    if (value === null || value === undefined || !Number.isFinite(value)) return false
    this.set(index, value)
    return true
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
