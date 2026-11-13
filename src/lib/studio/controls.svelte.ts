import { knobs } from '../device/knobs.svelte'
import { platform } from '../platform'

/** What a controller button or knob drives. Tracks and scenes are positions in the grid, so mappings survive edits. */
export type Target =
  | { kind: 'slot'; track: number; scene: number }
  | { kind: 'scene'; scene: number }
  | { kind: 'stop'; track: number }
  | { kind: 'stop-all' }
  | { kind: 'play' }
  | { kind: 'volume'; track: number }

type Binding = { status: number; data: number; target: Target }

const STORAGE_KEY = 'keyfall.controls.v1'
const KNOBS_KEY = 'keyfall.knob-ccs.v1'
const KNOB_COUNT = 4
const SUSTAIN_PEDAL = 64
/** CC 120 and up are channel-mode messages, never knobs. */
const MODE_MESSAGES = 120
const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CONTROL_CHANGE = 0xb0
const PRESSED = 64
const CC_MAX = 127

const same = (a: Target, b: Target) => JSON.stringify(a) === JSON.stringify(b)

function loadKnobs(): (number | null)[] {
  try {
    return JSON.parse(localStorage.getItem(KNOBS_KEY) ?? '[]')
  } catch {
    return []
  }
}

function load(): Binding[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

/** MIDI controller mappings (Launchpad/APC style): learn by arming a target and moving a control. */
class Controls {
  bindings = $state<Binding[]>(load())
  /** CC driving each device knob, by knob: the first knobs a controller sends claim free ones; learn picks one. */
  knobCCs = $state<(number | null)[]>(loadKnobs())
  /** Device knob waiting for the next controller knob to move. */
  learnKnob = $state<number | null>(null)
  learning = $state(false)
  armed = $state<Target | null>(null)
  /** Performs a mapped action; `value` is 0–1 for knobs and faders. */
  run?: (target: Target, value: number) => void

  constructor() {
    $effect.root(() => {
      $effect(() => {
        const bindings = $state.snapshot(this.bindings)
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
        } catch {}
        try {
          localStorage.setItem(KNOBS_KEY, JSON.stringify(this.knobCCs))
        } catch {}
        platform.midi.reserve([...bindings.map((b): [number, number] => [b.status, b.data]), ...this.knobCCs.filter((cc) => cc !== null).map((cc): [number, number] => [CONTROL_CHANGE, cc])])
      })
    })
  }

  /**
   * Consumes mapped messages and learns new ones; returns false for messages that should play notes.
   * Clip and scene mappings apply only in Studio (`studio`); the device knobs work everywhere.
   */
  handle([status, data, value]: number[], studio = true): boolean {
    const kind = status & 0xf0
    if (kind === CONTROL_CHANGE && this.#knob(data, value)) return true
    if (!studio) return false
    const isOn = kind === NOTE_ON && value > 0
    const key = kind === NOTE_OFF || kind === NOTE_ON ? NOTE_ON : kind
    if (this.learning && this.armed && (isOn || kind === CONTROL_CHANGE)) {
      const target = this.armed
      this.bindings = [...this.bindings.filter((b) => !(b.status === key && b.data === data) && !same(b.target, target)), { status: key, data, target }]
      this.armed = null
      return true
    }
    const binding = this.bindings.find((b) => b.status === key && b.data === data)
    if (!binding) return false
    if (kind === CONTROL_CHANGE) {
      if (binding.target.kind === 'volume') this.run?.(binding.target, value / CC_MAX)
      else if (value >= PRESSED) this.run?.(binding.target, 1)
    } else if (isOn) {
      this.run?.(binding.target, value / CC_MAX)
    }
    return true
  }

  #knob(cc: number, value: number) {
    if (cc === SUSTAIN_PEDAL || cc >= MODE_MESSAGES || this.bindings.some((b) => b.status === CONTROL_CHANGE && b.data === cc)) return false
    if (this.learnKnob !== null) {
      const next = Array.from({ length: KNOB_COUNT }, (_, i) => (this.knobCCs[i] === cc ? null : (this.knobCCs[i] ?? null)))
      next[this.learnKnob] = cc
      this.knobCCs = next
      this.learnKnob = null
    }
    let index = this.knobCCs.indexOf(cc)
    if (index < 0) {
      index = Array.from({ length: KNOB_COUNT }, (_, i) => this.knobCCs[i] ?? null).indexOf(null)
      if (index < 0) return false
      const next = [...this.knobCCs]
      next[index] = cc
      this.knobCCs = next
    }
    knobs.set(index, value / CC_MAX)
    return true
  }

  /** Frees a device knob from its controller knob. */
  forgetKnob(index: number) {
    const next = [...this.knobCCs]
    next[index] = null
    this.knobCCs = next
  }

  arm(target: Target) {
    this.armed = target
  }

  isArmed(target: Target) {
    return !!this.armed && same(this.armed, target)
  }

  label(target: Target): string | null {
    const binding = this.bindings.find((b) => same(b.target, target))
    if (!binding) return null
    return `${binding.status === CONTROL_CHANGE ? 'CC' : 'N'}${binding.data}`
  }

  unmap(target: Target) {
    this.bindings = this.bindings.filter((b) => !same(b.target, target))
  }
}

export const controls = new Controls()
