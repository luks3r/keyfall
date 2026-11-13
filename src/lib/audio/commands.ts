/** Real-time note commands shared by the main thread and the audio worklet. */

export const Op = { On: 1, Off: 2, AllOff: 3, Volume: 4, KeyOn: 5, KeyOff: 6, Pedal: 7, ReleaseChannel: 8, ChannelGain: 9, Launch: 10, Play: 11, Stop: 12 } as const

export const SLOT = 5
const CAPACITY = 1024
const MASK = CAPACITY - 1
const HEAD = 0
const TAIL = 1
/** Count of commands included in a rendered block; lets tools time the hand-off to the audio thread. */
export const APPLIED = 2
const HEADER = 4

export type Command = Int32Array<ArrayBuffer>

export function command(op: number, a = 0, b = 0, c = 0, value = 0): Command {
  const slot = new Int32Array(SLOT)
  slot.set([op, a, b, c])
  new Float32Array(slot.buffer)[4] = value
  return slot
}

export type Apply = (ints: Int32Array, floats: Float32Array, at: number) => void

export const ringSupported = () => typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated === true

export const createRingBuffer = () => new SharedArrayBuffer((HEADER + CAPACITY * SLOT) * Int32Array.BYTES_PER_ELEMENT)

/** Single-producer single-consumer ring of fixed-size slots. Lock-free; no allocation after construction. */
export class Ring {
  readonly ints: Int32Array<SharedArrayBuffer>
  readonly floats: Float32Array<SharedArrayBuffer>

  constructor(readonly buffer: SharedArrayBuffer) {
    this.ints = new Int32Array(buffer)
    this.floats = new Float32Array(buffer)
  }

  push(op: number, a: number, b: number, c: number, value: number) {
    const head = Atomics.load(this.ints, HEAD)
    if (((head - Atomics.load(this.ints, TAIL)) | 0) >= CAPACITY) return false
    const at = HEADER + (head & MASK) * SLOT
    this.ints[at] = op
    this.ints[at + 1] = a
    this.ints[at + 2] = b
    this.ints[at + 3] = c
    this.floats[at + 4] = value
    Atomics.store(this.ints, HEAD, (head + 1) | 0)
    return true
  }

  /** Applies every pending command; returns how many. */
  drain(apply: Apply) {
    const head = Atomics.load(this.ints, HEAD)
    let tail = Atomics.load(this.ints, TAIL)
    const count = (head - tail) | 0
    for (; tail !== head; tail = (tail + 1) | 0) apply(this.ints, this.floats, HEADER + (tail & MASK) * SLOT)
    Atomics.store(this.ints, TAIL, tail)
    return count
  }

  rendered(count: number) {
    if (count) Atomics.add(this.ints, APPLIED, count)
  }
}
