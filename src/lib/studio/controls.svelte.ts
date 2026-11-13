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
const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CONTROL_CHANGE = 0xb0
const PRESSED = 64
const CC_MAX = 127

const same = (a: Target, b: Target) => JSON.stringify(a) === JSON.stringify(b)

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
        platform.midi.reserve(bindings.map((b) => [b.status, b.data]))
      })
    })
  }

  /** Consumes mapped messages and learns new ones; returns false for messages that should play notes. */
  handle([status, data, value]: number[]): boolean {
    const kind = status & 0xf0
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
