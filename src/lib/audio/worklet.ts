import type { Sample } from '../platform/types'
import { Op, Ring, type Command } from './commands'

/** `status` receives the sequencer status after every block when memory can be shared. */
export type WorkletOptions = { wasm: ArrayBuffer; ring?: SharedArrayBuffer; status?: SharedArrayBuffer }

export type SequencerConfig = { tempo: number; quantum: number; beatsPerBar: number; metronome: boolean; loop: [number, number] | null }

export type WorkletMessage =
  | { type: 'command'; slot: Command }
  | { type: 'instrument'; channel: number; data: Float32Array<ArrayBuffer> }
  | { type: 'samples'; samples: Sample[] }
  | { type: 'pattern'; clip: number; data: Float32Array<ArrayBuffer> }
  | { type: 'timeline'; lane: number; data: Float32Array<ArrayBuffer> }
  | { type: 'config'; config: SequencerConfig }
  | { type: 'pad'; channel: number; midi: number; sample: Sample | null }
  | { type: 'kit-clear'; channel: number }

/** Without shared memory the worklet posts its status this often, in render blocks. */
const STATUS_EVERY = 4

type DspExports = {
  memory: WebAssembly.Memory
  engine_new(sampleRate: number): number
  note_on(engine: number, id: number, channel: number, midi: number, velocity: number): void
  note_off(engine: number, id: number): void
  key_on(engine: number, channel: number, midi: number, velocity: number): void
  key_off(engine: number, channel: number, midi: number): void
  pedal(engine: number, channel: number, down: boolean): void
  release_channel(engine: number, channel: number): void
  set_channel_gain(engine: number, channel: number, gain: number): void
  all_off(engine: number): void
  set_volume(engine: number, volume: number): void
  alloc(len: number): number
  set_instrument(engine: number, channel: number, ptr: number, len: number): number
  add_sample(engine: number, root: number, rate: number, ptr: number, len: number): void
  clear_samples(engine: number): void
  render(engine: number, frames: number): number
  seq_pattern(engine: number, id: number, ptr: number, len: number): boolean
  seq_timeline(engine: number, lane: number, ptr: number, len: number): void
  seq_launch(engine: number, lane: number, id: number, quantized: boolean): void
  seq_play(engine: number, from: number): void
  seq_stop(engine: number): void
  seq_config(engine: number, tempo: number, quantum: number, beatsPerBar: number, metronome: boolean, loopStart: number, loopEnd: number): void
  seq_status(engine: number): number
  seq_status_len(engine: number): number
  kit_pad(engine: number, channel: number, midi: number, rate: number, ptr: number, len: number): void
  kit_clear(engine: number, channel: number): void
}

declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

class KeyfallProcessor extends AudioWorkletProcessor {
  #dsp: DspExports
  #engine: number
  #ring?: Ring
  #pending = 0
  #status?: Float64Array
  #blocks = 0
  #apply = (ints: Int32Array, floats: Float32Array, at: number) => {
    const dsp = this.#dsp
    const engine = this.#engine
    switch (ints[at]) {
      case Op.On:
        return dsp.note_on(engine, ints[at + 1], ints[at + 2], ints[at + 3], floats[at + 4])
      case Op.Off:
        return dsp.note_off(engine, ints[at + 1])
      case Op.AllOff:
        return dsp.all_off(engine)
      case Op.Volume:
        return dsp.set_volume(engine, floats[at + 4])
      case Op.KeyOn:
        return dsp.key_on(engine, ints[at + 1], ints[at + 2], floats[at + 4])
      case Op.KeyOff:
        return dsp.key_off(engine, ints[at + 1], ints[at + 2])
      case Op.Pedal:
        return dsp.pedal(engine, ints[at + 1], ints[at + 2] !== 0)
      case Op.ReleaseChannel:
        return dsp.release_channel(engine, ints[at + 1])
      case Op.ChannelGain:
        return dsp.set_channel_gain(engine, ints[at + 1], floats[at + 4])
      case Op.Launch:
        return dsp.seq_launch(engine, ints[at + 1], ints[at + 2], ints[at + 3] !== 0)
      case Op.Play:
        return dsp.seq_play(engine, floats[at + 4])
      case Op.Stop:
        return dsp.seq_stop(engine)
    }
  }

  constructor({ processorOptions }: { processorOptions: WorkletOptions }) {
    super()
    const module = new WebAssembly.Module(processorOptions.wasm)
    this.#dsp = new WebAssembly.Instance(module, {}).exports as unknown as DspExports
    this.#engine = this.#dsp.engine_new(sampleRate)
    if (processorOptions.ring) this.#ring = new Ring(processorOptions.ring)
    if (processorOptions.status) this.#status = new Float64Array(processorOptions.status)
    this.port.onmessage = ({ data }: MessageEvent<WorkletMessage>) => this.#handle(data)
  }

  #copyFloats(data: Float32Array) {
    return this.#copy(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }

  #copy(bytes: Uint8Array) {
    const ptr = this.#dsp.alloc(bytes.length)
    new Uint8Array(this.#dsp.memory.buffer, ptr, bytes.length).set(bytes)
    return ptr
  }

  #handle(message: WorkletMessage) {
    const dsp = this.#dsp
    const engine = this.#engine
    switch (message.type) {
      case 'command':
        this.#apply(message.slot, new Float32Array(message.slot.buffer), 0)
        this.#pending++
        return
      case 'instrument':
        dsp.set_instrument(engine, message.channel, this.#copyFloats(message.data), message.data.length)
        return
      case 'pattern':
        dsp.seq_pattern(engine, message.clip, this.#copyFloats(message.data), message.data.length)
        return
      case 'timeline':
        return dsp.seq_timeline(engine, message.lane, this.#copyFloats(message.data), message.data.length)
      case 'config': {
        const { tempo, quantum, beatsPerBar, metronome, loop } = message.config
        return dsp.seq_config(engine, tempo, quantum, beatsPerBar, metronome, loop?.[0] ?? 0, loop?.[1] ?? 0)
      }
      case 'pad': {
        const { channel, midi, sample } = message
        if (!sample) return dsp.kit_pad(engine, channel, midi, 0, 0, 0)
        return dsp.kit_pad(engine, channel, midi, sample.rate, this.#copyFloats(sample.data), sample.data.length)
      }
      case 'kit-clear':
        return dsp.kit_clear(engine, message.channel)
      case 'samples':
        dsp.clear_samples(engine)
        for (const { root, rate, data } of message.samples) {
          dsp.add_sample(engine, root, rate, this.#copyFloats(data), data.length)
        }
    }
  }

  #report() {
    const dsp = this.#dsp
    const status = new Float64Array(dsp.memory.buffer, dsp.seq_status(this.#engine), dsp.seq_status_len(this.#engine))
    if (this.#status) this.#status.set(status.subarray(0, this.#status.length))
    else if (++this.#blocks % STATUS_EVERY === 0) this.port.postMessage({ type: 'status', status: status.slice() })
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const ring = this.#ring
    if (ring) {
      ring.rendered(ring.drain(this.#apply) + this.#pending)
      this.#pending = 0
    }
    const channels = outputs[0]
    const frames = channels[0].length
    const ptr = this.#dsp.render(this.#engine, frames)
    const block = new Float32Array(this.#dsp.memory.buffer, ptr, frames)
    for (const channel of channels) channel.set(block)
    this.#report()
    return true
  }
}

registerProcessor('keyfall', KeyfallProcessor)

/** Frames per message from the capture processor: ~43 ms at 48 kHz keeps the message rate low. */
export const CAPTURE_BLOCK = 2048

/** Copies its input to the main thread in blocks of `CAPTURE_BLOCK` frames, one array per channel. */
class CaptureProcessor extends AudioWorkletProcessor {
  #blocks: Float32Array[] = []
  #filled = 0

  process(inputs: Float32Array[][]) {
    const input = inputs[0]
    if (!input?.length) return true
    if (this.#blocks.length !== input.length) this.#blocks = input.map(() => new Float32Array(CAPTURE_BLOCK))
    const frames = input[0].length
    input.forEach((channel, i) => this.#blocks[i].set(channel, this.#filled))
    this.#filled += frames
    if (this.#filled + frames > CAPTURE_BLOCK) {
      const blocks = this.#blocks.map((block) => block.slice(0, this.#filled))
      this.port.postMessage(blocks, blocks.map((block) => block.buffer))
      this.#filled = 0
    }
    return true
  }
}

registerProcessor('keyfall-capture', CaptureProcessor)
