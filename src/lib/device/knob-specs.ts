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
}

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
}

/** Knob over a numeric range. */
export function rangeKnob(
  label: string,
  min: number,
  max: number,
  get: () => number,
  set: (v: number) => void,
  format: (v: number) => string,
  { initial, step, parse = parseNumber }: RangeOptions = {},
): KnobSpec {
  const span = max - min
  const toUnit = (v: number) => (v - min) / span
  return {
    label,
    value: () => toUnit(get()),
    set: (v) => {
      const raw = min + v * span
      set(step ? Math.round(raw / step) * step : raw)
    },
    display: () => format(get()),
    nudge: step ? Math.max(step / span, 1 / 400) : undefined,
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

/** Knob that clicks through a list of choices; typing picks the first choice whose name starts with the text. */
export function choiceKnob<T>(label: string, choices: readonly T[], get: () => T, set: (v: T) => void, format: (v: T) => string = String, initial?: T): KnobSpec {
  const last = Math.max(1, choices.length - 1)
  const index = (v: T) => Math.max(0, choices.indexOf(v))
  return {
    label,
    steps: Math.max(2, choices.length),
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
