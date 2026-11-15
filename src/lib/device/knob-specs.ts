/** Knob specs: what a knob controls, how it reads and resets. Pure, so screens and tests share them. */

/** One knob's job. `value`, `set`, `initial` and `parse` work in 0–1; `steps` makes it click through choices. */
export type KnobSpec = {
  label: string
  value: () => number
  set: (value: number) => void
  display: () => string
  steps?: number
  /** One arrow press or wheel notch, in 0–1 units. */
  nudge?: number
  /** Where reset goes. */
  initial?: number
  /** Reads typed text; null when it doesn't make sense. */
  parse?: (text: string) => number | null
  /** Every choice of a choice knob, so it can open as a list. */
  options?: KnobOption[]
}

/** One choice of a choice knob; `value` is in 0–1 like the knob. */
export type KnobOption = { label: string; value: number; group?: string }

const clamp = (value: number) => Math.max(0, Math.min(1, value))

/** Reads "120", "-3", "1.2k", "80%"; units are the caller's business. */
export function parseNumber(text: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(k)?/i.exec(text.trim())
  if (!match) return null
  return Number(match[1]) * (match[2] ? 1000 : 1)
}

type RangeOptions = {
  /** Value reset goes to. */
  initial?: number
  /** Snaps to multiples of this; arrows and wheel move one step. */
  step?: number
  /** Typed text to a value in range units. */
  parse?: (text: string) => number | null
  /** Even ratios instead of even steps across the turn, for times and frequencies; `min` must be above 0. */
  log?: boolean
}

/** Knob over a numeric range. */
export function rangeKnob(
  label: string,
  min: number,
  max: number,
  get: () => number,
  set: (v: number) => void,
  format: (v: number) => string,
  { initial, step, parse = parseNumber, log = false }: RangeOptions = {},
): KnobSpec {
  const span = max - min
  const ratio = Math.log(max / min)
  const toUnit = log ? (v: number) => Math.log(Math.max(min, v) / min) / ratio : (v: number) => (v - min) / span
  const fromUnit = log ? (u: number) => Number((min * Math.exp(u * ratio)).toPrecision(3)) : (u: number) => min + u * span
  return {
    label,
    value: () => clamp(toUnit(get())),
    set: (v) => {
      const raw = fromUnit(v)
      set(step ? Math.round(raw / step) * step : raw)
    },
    display: () => format(get()),
    nudge: step && !log ? Math.max(step / span, 1 / 400) : undefined,
    initial: initial === undefined ? undefined : toUnit(initial),
    parse: (text) => {
      const v = parse(text)
      return v === null ? null : clamp(toUnit(v))
    },
  }
}

/** Knob over 0–1 shown as a percentage; typing "80" means 80%. */
export function percentKnob(label: string, get: () => number, set: (v: number) => void, initial: number, min = 0, max = 1): KnobSpec {
  return rangeKnob(label, min, max, get, set, (v) => `${Math.round(v * 100)}%`, {
    initial,
    step: 0.01,
    parse: (text) => {
      const v = parseNumber(text)
      return v === null ? null : v / 100
    },
  })
}

/**
 * Knob that clicks through a list of choices; typing picks the first choice whose name starts with the text.
 * `group` heads the choices when they open as a list.
 */
export function choiceKnob<T>(label: string, choices: readonly T[], get: () => T, set: (v: T) => void, format: (v: T) => string = String, initial?: T, group?: (v: T) => string): KnobSpec {
  const last = Math.max(1, choices.length - 1)
  const index = (v: T) => Math.max(0, choices.indexOf(v))
  return {
    label,
    steps: Math.max(2, choices.length),
    options: choices.map((c, i) => ({ label: format(c), value: i / last, group: group?.(c) })),
    value: () => index(get()) / last,
    set: (v) => set(choices[Math.round(v * (choices.length - 1))]),
    display: () => format(get()),
    initial: initial === undefined ? undefined : index(initial) / last,
    parse: (text) => {
      const wanted = text.toLowerCase()
      if (!wanted) return null
      const names = choices.map((c) => format(c).toLowerCase())
      const found = [names.indexOf(wanted), names.findIndex((n) => n.startsWith(wanted)), names.findIndex((n) => n.includes(wanted))].find((i) => i >= 0)
      return found === undefined ? null : found / last
    },
  }
}

/** Notches per press of PageUp / PageDown. */
export const KNOB_COARSE = 10
const NUDGE = 1 / 50
const FINE = 1 / 4

/** Arrow press or wheel notch: one choice on choice knobs, `spec.nudge` on the rest. */
export function nudge(spec: KnobSpec, notches: number, fine = false) {
  if (!notches) return
  if (spec.steps) {
    const choice = Math.round(spec.value() * (spec.steps - 1)) + Math.sign(notches) * Math.max(1, Math.round(Math.abs(notches)))
    spec.set(clamp(choice / (spec.steps - 1)))
  } else {
    spec.set(clamp(spec.value() + notches * (spec.nudge ?? NUDGE) * (fine ? FINE : 1)))
  }
}

/** Sets a 0–1 value, landing on a choice for choice knobs. */
export function setTo(spec: KnobSpec, value: number) {
  spec.set(spec.steps ? Math.round(clamp(value) * (spec.steps - 1)) / (spec.steps - 1) : clamp(value))
}

export function reset(spec: KnobSpec) {
  if (spec.initial !== undefined) setTo(spec, spec.initial)
}

/** Applies typed text; returns false when the knob can't read it. */
export function enter(spec: KnobSpec, text: string) {
  const value = spec.parse?.(text.trim())
  if (value === null || value === undefined || !Number.isFinite(value)) return false
  setTo(spec, value)
  return true
}
