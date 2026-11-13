export type Device = { id: string; name: string }

export type Sample = { root: number; rate: number; data: Float32Array<ArrayBuffer> }

export type SequencerConfig = { tempo: number; quantum: number; beatsPerBar: number; metronome: boolean; loop: [number, number] | null }

/** Clip sequencer running in the audio engine (crates/dsp/src/sequencer.rs). Lanes are track indices. */
export interface Sequencer {
  pattern(clip: number, data: Float32Array<ArrayBuffer>): void
  timeline(lane: number, data: Float32Array<ArrayBuffer>): void
  /** Launches `clip` on `lane`, or stops the lane when `clip` is 0; quantized launches wait for the next quantum. */
  launch(lane: number, clip: number, quantized: boolean): void
  play(from: number): void
  stop(): void
  configure(config: SequencerConfig): void
  /** Latest engine status (`STATUS_HEADER` layout), or null before the first report. */
  status(): Float64Array | null
}

export interface AudioBackend {
  readonly canSelectOutput: boolean
  readonly canSetBuffer: boolean
  noteOn(id: number, channel: number, midi: number, velocity: number): void
  noteOff(id: number): void
  /** Keys track held notes and the sustain pedal per channel inside the audio engine. */
  keyOn(channel: number, midi: number, velocity: number): void
  keyOff(channel: number, midi: number): void
  pedal(channel: number, down: boolean): void
  releaseChannel(channel: number): void
  setChannelGain(channel: number, gain: number): void
  /** Channel that native fast paths (keyboard, MIDI input) play on. */
  setLiveChannel(channel: number): void
  /** Input note to sounding notes for native fast paths; an empty table plays notes as they are. */
  setNoteMap(table: number[][]): void
  readonly sequencer: Sequencer
  /** Puts a one-shot sample on a pad of the channel's kit; null clears the pad. */
  setPad(channel: number, midi: number, sample: Sample | null): void
  clearKit(channel: number): void
  allOff(): void
  /** Native fast paths (MIDI input, remote notes) stay silent while muted. */
  setMuted(muted: boolean): void
  setVolume(volume: number): void
  setInstrument(channel: number, data: Float32Array<ArrayBuffer>): void
  loadSamples(samples: Sample[]): Promise<void>
  outputs(): Promise<Device[]>
  setOutput(id: string | null): Promise<void>
  setBuffer(frames: number): Promise<void>
  /** Worst-case milliseconds from a note command to sound leaving the device, or null when unknown. */
  latency(): Promise<number | null>
}

/** Recorded audio: one array per channel. */
export type Capture = { sampleRate: number; channels: Float32Array<ArrayBuffer>[] }

export interface Recording {
  stop(): Promise<Capture>
}

/** Microphone and line-in capture, prepared for audio tracks. */
export interface AudioInput {
  devices(): Promise<Device[]>
  /** Starts recording from `device` (null: system default); `onLevel` receives the peak (0–1) as it records. */
  record(device: string | null, onLevel?: (peak: number) => void): Promise<Recording>
}

export interface MidiBackend {
  readonly supported: boolean
  readonly needsPermission: boolean
  inputs(): Promise<Device[]>
  outputs(): Promise<Device[]>
  /** `sounded` is true when the backend already played the message through the audio engine. */
  openInput(id: string | null, onMessage: (message: number[], sounded: boolean) => void): Promise<void>
  openOutput(id: string | null): Promise<void>
  send(message: number[]): void
  /** Messages `(status kind, data byte)` mapped to controls; native input then never plays them. */
  reserve(controls: [number, number][]): void
}

export interface Socket {
  send(frame: string | Uint8Array<ArrayBuffer>): void
  close(): void
  /** Lets the backend play a peer's relayed notes on `channel` itself; null stops it. */
  route?(peer: number, channel: number | null): void
  /** `played` is true when the backend already sounded this relayed note event. */
  onmessage?: (frame: string | Uint8Array<ArrayBuffer>, played: boolean) => void
  onclose?: () => void
}

/** Absolute notes the native keyboard fast path plays, keyed by DOM `code` (`Shift+Code` for the Shift layer). */
export type NativeLayout = { enabled: boolean; shifted: boolean; velocity: number; notes: Record<string, number> }

export interface NativeKeyboard {
  /** Resolves true when the platform now sounds mapped keys itself. */
  setLayout(layout: NativeLayout): Promise<boolean>
}

export type HostInfo = { port: number; urls: string[] }
export type NearbyHost = { name: string; url: string }

export interface Platform {
  readonly native: boolean
  readonly audio: AudioBackend
  readonly midi: MidiBackend
  readonly input: AudioInput
  readonly keyboard?: NativeKeyboard
  saveFile(name: string, data: Uint8Array<ArrayBuffer>): Promise<void>
  connect(url: string): Promise<Socket>
  host?(port: number, name: string): Promise<HostInfo>
  stopHost?(): Promise<void>
  hosting?(): Promise<HostInfo | null>
  discover?(onFound: (hosts: NearbyHost[]) => void): Promise<() => void>
}
