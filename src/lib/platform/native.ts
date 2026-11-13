import { Channel, invoke } from '@tauri-apps/api/core'
import type { AudioBackend, AudioInput, Capture, Sequencer, Device, HostInfo, MidiBackend, NearbyHost, Platform, Sample, Socket } from './types'

const fire = (command: string, args?: Record<string, unknown>) => {
  invoke(command, args).catch((error) => console.error(command, error))
}

const byName = (names: string[]): Device[] => names.map((name) => ({ id: name, name }))

let status: Float64Array | null = null
let polling = false

/** Status crosses the IPC boundary, so reads return the last report and ask for the next one. */
function pollStatus() {
  if (polling) return
  polling = true
  invoke<number[]>('seq_status').then(
    (values) => ((status = Float64Array.from(values)), (polling = false)),
    () => (polling = false),
  )
}

const sequencer: Sequencer = {
  pattern: (clip, data) => fire('seq_pattern', { id: clip, data: [...data] }),
  timeline: (lane, data) => fire('seq_timeline', { lane, data: [...data] }),
  launch: (lane, clip, quantized) => fire('seq_launch', { lane, id: clip, quantized }),
  play: (from) => fire('seq_play', { from }),
  stop: () => fire('seq_stop'),
  configure: (config) => fire('seq_config', { config }),
  status() {
    pollStatus()
    return status
  },
}

const audio: AudioBackend = {
  canSelectOutput: true,
  canSetBuffer: true,
  noteOn: (id, channel, midi, velocity) => fire('note_on', { id, channel, midi, velocity }),
  noteOff: (id) => fire('note_off', { id }),
  keyOn: (channel, midi, velocity) => fire('key_on', { channel, midi, velocity }),
  keyOff: (channel, midi) => fire('key_off', { channel, midi }),
  pedal: (channel, down) => fire('pedal', { channel, down }),
  releaseChannel: (channel) => fire('release_channel', { channel }),
  setChannelGain: (channel, gain) => fire('channel_gain', { channel, gain }),
  sequencer,
  setPad: (channel, midi, sample) =>
    void invoke('kit_pad', sample ? new Uint8Array(sample.data.buffer, sample.data.byteOffset, sample.data.byteLength) : new Uint8Array(), {
      headers: { 'x-channel': String(channel), 'x-midi': String(midi), 'x-rate': String(sample?.rate ?? 0) },
    }).catch((error) => console.error('kit_pad', error)),
  clearKit: (channel) => fire('kit_clear', { channel }),
  setLiveChannel: (channel) => fire('set_live_channel', { channel }),
  setNoteMap: (table) => fire('set_note_map', { map: table }),
  allOff: () => fire('all_off'),
  setMuted: (muted) => fire('set_muted', { muted }),
  setVolume: (volume) => fire('set_volume', { volume }),
  setInstrument: (channel, data) => fire('set_instrument', { channel, data: [...data] }),
  async loadSamples(samples: Sample[]) {
    await invoke('clear_samples')
    await Promise.all(
      samples.map(({ root, rate, data }) =>
        invoke('add_sample', new Uint8Array(data.buffer), { headers: { 'x-root': String(root), 'x-rate': String(rate) } }),
      ),
    )
  },
  outputs: async () => byName(await invoke<string[]>('audio_outputs')),
  setOutput: (name) => invoke('set_audio_output', { name }),
  setBuffer: (frames) => invoke('set_audio_buffer', { frames }),
  latency: async () => (await invoke<{ output_ms: number }>('audio_latency')).output_ms,
}

const input: AudioInput = {
  devices: async () => byName(await invoke<string[]>('audio_inputs')),
  async record(name, onLevel) {
    const level = new Channel<number>()
    if (onLevel) level.onmessage = onLevel
    await invoke('capture_start', { name, level })
    return {
      async stop(): Promise<Capture> {
        const bytes = await invoke<ArrayBuffer>('capture_stop')
        const view = new DataView(bytes)
        const sampleRate = view.getUint32(0, true)
        const count = view.getUint16(4, true)
        const interleaved = new Float32Array(bytes.slice(6))
        const frames = Math.floor(interleaved.length / count)
        const channels = Array.from({ length: count }, (_, c) => Float32Array.from({ length: frames }, (_, i) => interleaved[i * count + c]))
        return { sampleRate, channels }
      },
    }
  },
}

const midi: MidiBackend = {
  supported: true,
  needsPermission: false,
  inputs: async () => byName(await invoke<string[]>('midi_inputs')),
  outputs: async () => byName(await invoke<string[]>('midi_outputs')),
  openInput(name, onMessage) {
    const channel = new Channel<ArrayBuffer>()
    channel.onmessage = (buffer) => {
      const [sounded, ...message] = new Uint8Array(buffer)
      onMessage(message, sounded === 1)
    }
    return invoke('midi_open_input', { name, channel })
  },
  openOutput: (name) => invoke('midi_open_output', { name }),
  send: (message) => fire('midi_send', { message }),
  reserve: (controls) => fire('midi_reserve', { controls }),
}

/** Tags of socket frames from `src-tauri/src/net.rs`. */
const SOCKET_TEXT = 0
const SOCKET_BINARY = 1
const SOCKET_PLAYED = 3
const decoder = new TextDecoder()

async function connect(url: string): Promise<Socket> {
  const events = new Channel<ArrayBuffer>()
  const id = await invoke<number>('socket_open', { url, events })
  const socket: Socket = {
    send: (frame) =>
      typeof frame === 'string'
        ? fire('socket_send', { id, text: frame })
        : void invoke('socket_send_binary', frame, { headers: { 'x-socket': String(id) } }).catch((error) => console.error(error)),
    close: () => fire('socket_close', { id }),
    route: (peer, channel) => fire('socket_route', { id, peer, channel }),
  }
  events.onmessage = (buffer) => {
    const frame = new Uint8Array(buffer)
    if (frame[0] === SOCKET_TEXT) socket.onmessage?.(decoder.decode(frame.subarray(1)), false)
    else if (frame[0] === SOCKET_BINARY || frame[0] === SOCKET_PLAYED) socket.onmessage?.(frame.slice(1), frame[0] === SOCKET_PLAYED)
    else socket.onclose?.()
  }
  return socket
}

export function createPlatform(): Platform {
  return {
    native: true,
    connect,
    host: (port, name) => invoke<HostInfo>('room_host', { port, name }),
    stopHost: () => invoke('room_stop'),
    hosting: () => invoke<HostInfo | null>('room_hosting'),
    async discover(onFound) {
      const found = new Channel<NearbyHost[]>()
      found.onmessage = onFound
      await invoke('discover_start', { found })
      return () => fire('discover_stop')
    },
    audio,
    input,
    midi,
    keyboard: { setLayout: (layout) => invoke<boolean>('keyboard_layout', { layout }) },
    async saveFile(name, data) {
      await invoke('save_file', { name, data: [...data] })
    },
  }
}
