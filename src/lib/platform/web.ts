import wasmUrl from '../audio/dsp.wasm?url'
import workletUrl from '../audio/worklet.ts?worker&url'
import { command, createRingBuffer, Op, Ring, ringSupported } from '../audio/commands'
import type { WorkletMessage, WorkletOptions } from '../audio/worklet'
import type { AudioBackend, AudioInput, Capture, Device, MidiBackend, Platform, Sample, Sequencer, SequencerConfig, Socket } from './types'

type SinkContext = AudioContext & { setSinkId(id: string): Promise<void> }

const RENDER_QUANTUM = 128
/** Matches `Sequencer::status_len` for the engine's 31 track lanes. */
const STATUS_LENGTH = 4 + 31 * 3
const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const

class WebAudio implements AudioBackend {
  readonly canSelectOutput = 'setSinkId' in AudioContext.prototype
  readonly canSetBuffer = false

  #ctx = new AudioContext({ latencyHint: 'interactive' })
  #node?: AudioWorkletNode
  #ring = ringSupported() ? new Ring(createRingBuffer()) : undefined
  #statusBuffer = ringSupported() ? new SharedArrayBuffer(STATUS_LENGTH * Float64Array.BYTES_PER_ELEMENT) : undefined
  #status: Float64Array | null = this.#statusBuffer ? new Float64Array(this.#statusBuffer) : null
  #reported = !!this.#statusBuffer
  #ready = this.#init()

  constructor() {
    const unlock = () => {
      if (this.#ctx.state === 'running') return UNLOCK_EVENTS.forEach((type) => removeEventListener(type, unlock, true))
      void this.#ctx.resume()
    }
    UNLOCK_EVENTS.forEach((type) => addEventListener(type, unlock, true))
  }

  async setBuffer() {}

  async latency() {
    const { baseLatency, outputLatency, sampleRate } = this.#ctx
    return ((baseLatency || 0) + (outputLatency || 0) + RENDER_QUANTUM / sampleRate) * 1000
  }

  async #init() {
    const [wasm] = await Promise.all([
      fetch(wasmUrl).then((response) => response.arrayBuffer()),
      this.#ctx.audioWorklet.addModule(workletUrl),
    ])
    this.#node = new AudioWorkletNode(this.#ctx, 'keyfall', {
      numberOfInputs: 0,
      outputChannelCount: [2],
      processorOptions: { wasm, ring: this.#ring?.buffer, status: this.#statusBuffer } satisfies WorkletOptions,
    })
    this.#node.port.onmessage = ({ data }: MessageEvent<{ type: 'status'; status: Float64Array }>) => {
      this.#status = data.status
      this.#reported = true
    }
    this.#node.connect(this.#ctx.destination)
  }

  #post(message: WorkletMessage, transfer: Transferable[] = []) {
    if (this.#ctx.state === 'suspended') void this.#ctx.resume()
    if (this.#node) this.#node.port.postMessage(message, transfer)
    else void this.#ready.then(() => this.#node!.port.postMessage(message, transfer))
  }

  /** Real-time path: shared ring when cross-origin isolated, otherwise one message per command. */
  #send(op: number, a = 0, b = 0, c = 0, value = 0) {
    if (this.#ctx.state === 'suspended') void this.#ctx.resume()
    if (this.#ring?.push(op, a, b, c, value)) return
    this.#post({ type: 'command', slot: command(op, a, b, c, value) })
  }

  noteOn(id: number, channel: number, midi: number, velocity: number) {
    this.#send(Op.On, id, channel, midi, velocity)
  }

  noteOff(id: number) {
    this.#send(Op.Off, id)
  }

  keyOn(channel: number, midi: number, velocity: number) {
    this.#send(Op.KeyOn, channel, midi, 0, velocity)
  }

  keyOff(channel: number, midi: number) {
    this.#send(Op.KeyOff, channel, midi)
  }

  pedal(channel: number, down: boolean) {
    this.#send(Op.Pedal, channel, Number(down))
  }

  releaseChannel(channel: number) {
    this.#send(Op.ReleaseChannel, channel)
  }

  setChannelGain(channel: number, gain: number) {
    this.#send(Op.ChannelGain, channel, 0, 0, gain)
  }

  readonly sequencer: Sequencer = {
    pattern: (clip, data) => this.#post({ type: 'pattern', clip, data }, [data.buffer]),
    timeline: (lane, data) => this.#post({ type: 'timeline', lane, data }, [data.buffer]),
    launch: (lane, clip, quantized) => this.#send(Op.Launch, lane, clip, Number(quantized)),
    play: (from) => this.#send(Op.Play, 0, 0, 0, from),
    stop: () => this.#send(Op.Stop),
    configure: (config: SequencerConfig) => this.#post({ type: 'config', config }),
    status: () => (this.#reported ? this.#status : null),
  }

  setPad(channel: number, midi: number, sample: Sample | null) {
    const copy = sample && { ...sample, data: sample.data.slice() }
    this.#post({ type: 'pad', channel, midi, sample: copy }, copy ? [copy.data.buffer] : [])
  }

  setLiveChannel() {}

  setNoteMap() {}

  clearKit(channel: number) {
    this.#post({ type: 'kit-clear', channel })
  }

  allOff() {
    this.#send(Op.AllOff)
  }

  setMuted() {}

  setVolume(volume: number) {
    this.#send(Op.Volume, 0, 0, 0, volume)
  }

  setInstrument(channel: number, data: Float32Array<ArrayBuffer>) {
    this.#post({ type: 'instrument', channel, data })
  }

  async loadSamples(samples: Sample[]) {
    const copies = samples.map((sample) => ({ ...sample, data: sample.data.slice() }))
    this.#post({ type: 'samples', samples: copies }, copies.map((sample) => sample.data.buffer))
  }

  async outputs(): Promise<Device[]> {
    if (!this.canSelectOutput || !navigator.mediaDevices) return []
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default')
      .map((device, i) => ({ id: device.deviceId, name: device.label || `Output ${i + 1}` }))
  }

  async setOutput(id: string | null) {
    if (this.canSelectOutput) await (this.#ctx as SinkContext).setSinkId(id ?? '')
  }

  /** Captures through the same context so recordings share the output clock. */
  async capture(device: string | null, onLevel?: (peak: number) => void) {
    await this.#ready
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: device ? { exact: device } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
    const source = this.#ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(this.#ctx, 'keyfall-capture', { numberOfOutputs: 0 })
    const blocks: Float32Array[][] = []
    node.port.onmessage = ({ data }: MessageEvent<Float32Array[]>) => {
      blocks.push(data)
      onLevel?.(data.reduce((peak, channel) => channel.reduce((m, s) => Math.max(m, Math.abs(s)), peak), 0))
    }
    source.connect(node)
    const sampleRate = this.#ctx.sampleRate
    return {
      async stop(): Promise<Capture> {
        source.disconnect()
        node.port.onmessage = null
        stream.getTracks().forEach((track) => track.stop())
        const count = blocks[0]?.length ?? 1
        const frames = blocks.reduce((sum, block) => sum + block[0].length, 0)
        const channels = Array.from({ length: count }, (_, c) => {
          const joined = new Float32Array(frames)
          let at = 0
          for (const block of blocks) {
            joined.set(block[c] ?? block[0], at)
            at += block[0].length
          }
          return joined
        })
        return { sampleRate, channels }
      },
    }
  }
}

class WebInput implements AudioInput {
  constructor(readonly audio: WebAudio) {}

  async devices(): Promise<Device[]> {
    if (!navigator.mediaDevices) return []
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((device) => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default')
      .map((device, i) => ({ id: device.deviceId, name: device.label || `Input ${i + 1}` }))
  }

  record(device: string | null, onLevel?: (peak: number) => void) {
    return this.audio.capture(device, onLevel)
  }
}

class WebMidi implements MidiBackend {
  readonly supported = 'requestMIDIAccess' in navigator
  readonly needsPermission = true

  #access?: Promise<MIDIAccess>
  #input?: MIDIInput
  #output?: MIDIOutput

  #request() {
    this.#access ??= navigator.requestMIDIAccess().catch((error) => {
      this.#access = undefined
      throw error
    })
    return this.#access
  }

  async inputs() {
    const access = await this.#request()
    return [...access.inputs.values()].map((port) => ({ id: port.id, name: port.name ?? port.id }))
  }

  async outputs() {
    const access = await this.#request()
    return [...access.outputs.values()].map((port) => ({ id: port.id, name: port.name ?? port.id }))
  }

  async openInput(id: string | null, onMessage: (message: number[], sounded: boolean) => void) {
    if (this.#input) this.#input.onmidimessage = null
    this.#input = undefined
    if (!id) return
    const port = (await this.#request()).inputs.get(id)
    if (!port) throw new Error('MIDI input unavailable')
    port.onmidimessage = ({ data }) => data && onMessage([...data], false)
    this.#input = port
  }

  async openOutput(id: string | null) {
    this.#output = undefined
    if (!id) return
    const port = (await this.#request()).outputs.get(id)
    if (!port) throw new Error('MIDI output unavailable')
    this.#output = port
  }

  send(message: number[]) {
    this.#output?.send(message)
  }

  reserve() {}
}

function connect(url: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    const socket: Socket = { send: (frame) => ws.readyState === WebSocket.OPEN && ws.send(frame), close: () => ws.close() }
    ws.onopen = () => resolve(socket)
    ws.onerror = () => reject(new Error(`Can't reach ${url}`))
    ws.onmessage = ({ data }) => socket.onmessage?.(typeof data === 'string' ? data : new Uint8Array(data as ArrayBuffer), false)
    ws.onclose = () => socket.onclose?.()
  })
}

export function createPlatform(): Platform {
  const audio = new WebAudio()
  return {
    native: false,
    connect,
    audio,
    input: new WebInput(audio),
    midi: new WebMidi(),
    async saveFile(name, data) {
      const link = document.createElement('a')
      link.href = URL.createObjectURL(new Blob([data]))
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    },
  }
}
