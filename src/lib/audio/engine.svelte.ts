import { platform } from '../platform'
import { encodeSynth, type SynthPatch } from './patch'
import { BUILT_IN, loadPack, type SamplePack } from './presets'

export interface Voice {
  stop(): void
}

export type EngineStatus = 'loading' | 'ready' | 'error'

/** Instrument as shared with other players: encoded patch plus the sampled preset id it needs, if any. */
export type SoundData = { data: number[]; sampled: string | null }

export const LOCAL_CHANNEL = 0
/** Last DSP channel (crates/dsp MAX_CHANNELS - 1), reserved for metronome clicks. */
export const CLICK_CHANNEL = 63
/** Channels 1..PEER_CHANNELS belong to remote players; Studio tracks use the range after them. */
export const PEER_CHANNELS = 31
export const FIRST_TRACK_CHANNEL = PEER_CHANNELS + 1
export const TRACK_CHANNELS = CLICK_CHANNEL - FIRST_TRACK_CHANNEL

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CONTROL_CHANGE = 0xb0
const SUSTAIN_PEDAL = 64
const MIDI_MAX = 127
const LATENCY_POLL_MS = 2000

class Engine {
  status = $state<EngineStatus>('ready')
  /** Reported milliseconds from note command to speaker, or null when the backend cannot tell. */
  latency = $state<number | null>(null)

  #muted = false
  /** Channel the player's own input sounds on: the local instrument in Learn, the selected track in Studio. */
  liveChannel = LOCAL_CHANNEL

  #nextId = 1
  #request = 0
  #pack?: Promise<void>
  #packSource?: SamplePack

  #ensurePack(pack: SamplePack) {
    if (this.#packSource !== pack || !this.#pack) {
      this.#packSource = pack
      this.#pack = loadPack(pack).then((samples) => platform.audio.loadSamples(samples))
      this.#pack.catch(() => (this.#pack = undefined))
    }
    return this.#pack
  }

  setSynth(patch: SynthPatch) {
    this.#request++
    platform.audio.setInstrument(LOCAL_CHANNEL, encodeSynth(patch))
    this.status = 'ready'
  }

  async setSound(channel: number, sound: SoundData) {
    const request = channel === LOCAL_CHANNEL ? ++this.#request : 0
    const pack = BUILT_IN.find((preset) => preset.id === sound.sampled)
    try {
      if (pack?.kind === 'sampled') {
        if (request) this.status = 'loading'
        await this.#ensurePack(pack.pack)
      }
      if (request && request !== this.#request) return
      platform.audio.setInstrument(channel, Float32Array.from(sound.data))
      if (request) this.status = 'ready'
    } catch (error) {
      console.error(error)
      if (request === this.#request) this.status = 'error'
    }
  }

  setVolume(volume: number) {
    platform.audio.setVolume(volume)
  }

  setBuffer(frames: number) {
    return platform.audio.canSetBuffer ? platform.audio.setBuffer(frames) : Promise.resolve()
  }

  /** Keeps `latency` current; output latency settles after start and changes with the device. */
  watchLatency() {
    const measure = () =>
      platform.audio.latency().then(
        (ms) => (this.latency = ms),
        () => (this.latency = null),
      )
    void measure()
    const poll = setInterval(measure, LATENCY_POLL_MS)
    return () => clearInterval(poll)
  }

  async setOutput(id: string | null) {
    platform.audio.allOff()
    await platform.audio.setOutput(id)
  }

  get muted() {
    return this.#muted
  }

  set muted(muted: boolean) {
    this.#muted = muted
    platform.audio.setMuted(muted)
  }

  /** One-shot note with its own lifetime, for song playback and clicks. */
  noteOn(midi: number, velocity: number, channel = LOCAL_CHANNEL): Voice {
    const id = this.#nextId++
    const muted = this.#muted
    const local = channel === LOCAL_CHANNEL
    if (!muted) platform.audio.noteOn(id, channel, midi, velocity)
    if (local) platform.midi.send([NOTE_ON, midi, midiVelocity(velocity)])
    let stopped = false
    return {
      stop() {
        if (stopped) return
        stopped = true
        if (!muted) platform.audio.noteOff(id)
        if (local) platform.midi.send([NOTE_OFF, midi, 0])
      },
    }
  }

  /** A played key; the engine tracks it per channel with that channel's sustain pedal. `sounded` skips audio a fast path already played. */
  keyOn(channel: number, midi: number, velocity: number, sounded = false) {
    if (!sounded && !this.#muted) platform.audio.keyOn(channel, midi, velocity)
    if (channel === this.liveChannel) platform.midi.send([NOTE_ON, midi, midiVelocity(velocity)])
  }

  /** Every `keyOn` needs its `keyOff`; `stillHeld` (another key shares the note) keeps MIDI out from cutting it. */
  keyOff(channel: number, midi: number, sounded = false, stillHeld = false) {
    if (!sounded && !this.#muted) platform.audio.keyOff(channel, midi)
    if (channel === this.liveChannel && !stillHeld) platform.midi.send([NOTE_OFF, midi, 0])
  }

  pedal(channel: number, down: boolean, sounded = false) {
    if (!sounded && !this.#muted) platform.audio.pedal(channel, down)
    if (channel === this.liveChannel) platform.midi.send([CONTROL_CHANGE, SUSTAIN_PEDAL, down ? MIDI_MAX : 0])
  }

  setLiveChannel(channel: number) {
    this.liveChannel = channel
    platform.audio.setLiveChannel(channel)
  }

  releaseChannel(channel: number) {
    platform.audio.releaseChannel(channel)
  }

  setChannelGain(channel: number, gain: number) {
    platform.audio.setChannelGain(channel, gain)
  }
}

const midiVelocity = (velocity: number) => Math.max(1, Math.round(velocity * MIDI_MAX))

export const engine = new Engine()
