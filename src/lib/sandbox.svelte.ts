export const LOCAL = 0

export type Stroke = { midi: number; velocity: number; start: number; end: number; owner: number }

/** Receives everything played freely, with its time in `clock()` seconds; Studio records through it. */
export interface Capture {
  noteOn(midi: number, velocity: number, owner: number, at: number): void
  noteOff(midi: number, owner: number, at: number): void
  pedal(down: boolean, owner: number, at: number): void
}

const HORIZON = 4

export const clock = () => performance.now() / 1000

/** Free play by everyone in the session: falling strokes for the roll, forwarded to an optional capture. */
export class Sandbox {
  readonly strokes: Stroke[] = []
  capture?: Capture

  #open = new Map<string, Stroke>()

  noteOn(midi: number, velocity: number, owner = LOCAL) {
    this.noteOff(midi, owner)
    const stroke = { midi, velocity, start: clock(), end: Infinity, owner }
    this.strokes.push(stroke)
    this.#open.set(`${owner}:${midi}`, stroke)
    this.capture?.noteOn(midi, velocity, owner, stroke.start)
  }

  noteOff(midi: number, owner = LOCAL) {
    const key = `${owner}:${midi}`
    const stroke = this.#open.get(key)
    if (!stroke) return
    stroke.end = clock()
    this.#open.delete(key)
    this.capture?.noteOff(midi, owner, stroke.end)
  }

  pedal(down: boolean, owner = LOCAL) {
    this.capture?.pedal(down, owner, clock())
  }

  prune(now: number) {
    let kept = 0
    for (const stroke of this.strokes) if (stroke.end > now - HORIZON) this.strokes[kept++] = stroke
    this.strokes.length = kept
  }
}
