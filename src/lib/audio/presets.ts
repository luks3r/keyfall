import type { Sample } from '../platform/types'
import type { Harmonic, SynthPatch, Wave } from './patch'

export type SamplePack = { baseUrl: string; samples: Record<number, string> }

/** `group` heads the sound in lists (Keys, Synth, Guitar & strings); the player's own sounds have none. */
export type SynthPreset = { id: string; name: string; kind: 'synth'; patch: SynthPatch; group?: string }
export type SampledPreset = { id: string; name: string; kind: 'sampled'; pack: SamplePack; release: number; gain: number; group?: string }
export type SoundPreset = SynthPreset | SampledPreset

const h = (ratio: number, wave: Wave, gain: number, detune = 0): Harmonic => ({ ratio, wave, gain, detune })

const BASE: SynthPatch = {
  attack: 0.004,
  decay: 1,
  sustain: 0,
  release: 0.07,
  gain: 1,
  keyTrack: false,
  filter: { enabled: false, base: 400, track: 1.5, env: 2, decay: 1 },
  fm: { enabled: false, ratio: 1, index: 1, decay: 0.4 },
  partials: [h(1, 'sine', 0.8)],
}

const synth = (group: string, id: string, name: string, patch: Partial<SynthPatch>): SynthPreset => ({ id, name, kind: 'synth', group, patch: { ...BASE, ...patch } })

const KEYS = 'Keys'
const SYNTH = 'Synth'
const STRINGS = 'Guitar & strings'

const PITCH_CLASS: Record<string, number> = { C: 0, Cs: 1, D: 2, Ds: 3, E: 4, F: 5, Fs: 6, G: 7, Gs: 8, A: 9, As: 10, B: 11 }
/** A pack from note-named files ("Cs4" is C♯4) at `baseUrl`. */
function pack(baseUrl: string, names: string, extension = 'mp3'): SamplePack {
  const samples: Record<number, string> = {}
  for (const name of names.trim().split(/\s+/)) {
    const [, pitch, octave] = /^([A-G]s?)(\d)$/.exec(name)!
    samples[12 * (Number(octave) + 1) + PITCH_CLASS[pitch]] = `${name}.${extension}`
  }
  return { baseUrl, samples }
}
const sampled = (group: string, id: string, name: string, samples: SamplePack, release: number, gain: number): SampledPreset => ({ id, name, kind: 'sampled', group, pack: samples, release, gain })

const SALAMANDER_NAMES: Record<number, string> = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' }
const salamander: Record<number, string> = {}
for (let midi = 21; midi <= 108; midi += 3) salamander[midi] = `${SALAMANDER_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}.mp3`
/** Recordings from nbrosowsky/tonejs-instruments (samples CC BY 3.0), served by its GitHub Pages site. */
const INSTRUMENTS = 'https://nbrosowsky.github.io/tonejs-instruments/samples/'

export const BUILT_IN: SoundPreset[] = [
  synth(KEYS, 'piano', 'Soft Piano', {
    decay: 2.2,
    keyTrack: true,
    filter: { enabled: true, base: 300, track: 1.5, env: 4, decay: 1 },
    partials: [h(1, 'triangle', 0.55), h(1, 'sine', 0.35, 5), h(2, 'sine', 0.22, -4), h(3, 'sine', 0.07, 3), h(4, 'sine', 0.03)],
  }),
  { id: 'grand', name: 'Grand Piano', kind: 'sampled', group: KEYS, pack: { baseUrl: 'https://tonejs.github.io/audio/salamander/', samples: salamander }, release: 0.25, gain: 1.4 },
  synth(KEYS, 'epiano', 'E-Piano Tine', {
    attack: 0.002,
    decay: 1.8,
    release: 0.12,
    keyTrack: true,
    fm: { enabled: true, ratio: 1, index: 1.6, decay: 0.35 },
    partials: [h(1, 'sine', 0.8), h(2, 'sine', 0.12, 2)],
  }),
  synth(KEYS, 'epiano-reed', 'E-Piano Reed', {
    attack: 0.002,
    decay: 1.4,
    release: 0.1,
    keyTrack: true,
    filter: { enabled: true, base: 1200, track: 1, env: 1.5, decay: 0.5 },
    fm: { enabled: true, ratio: 1, index: 2.6, decay: 0.18 },
    partials: [h(1, 'triangle', 0.55), h(2, 'sine', 0.15)],
  }),
  synth(KEYS, 'epiano-fm', 'E-Piano FM', {
    attack: 0.002,
    decay: 2.4,
    release: 0.15,
    keyTrack: true,
    fm: { enabled: true, ratio: 14, index: 0.8, decay: 0.12 },
    partials: [h(1, 'sine', 0.7), h(1, 'sine', 0.2, 6)],
  }),
  synth(KEYS, 'epiano-soft', 'E-Piano Soft', {
    attack: 0.003,
    decay: 2.5,
    release: 0.2,
    keyTrack: true,
    filter: { enabled: true, base: 600, track: 1.2, env: 2, decay: 0.8 },
    fm: { enabled: true, ratio: 1, index: 0.7, decay: 0.8 },
    partials: [h(1, 'sine', 0.7), h(1, 'triangle', 0.15, 3)],
  }),
  synth(KEYS, 'organ', 'Organ', {
    attack: 0.008,
    sustain: 1,
    release: 0.04,
    gain: 0.7,
    partials: [h(0.5, 'sine', 0.4), h(1, 'sine', 0.55), h(2, 'sine', 0.35), h(3, 'sine', 0.2), h(4, 'sine', 0.15), h(8, 'sine', 0.06)],
  }),
  synth(KEYS, 'marimba', 'Marimba', {
    attack: 0.002,
    decay: 0.35,
    release: 0.1,
    keyTrack: true,
    partials: [h(1, 'sine', 0.85), h(4, 'sine', 0.18), h(10, 'sine', 0.04)],
  }),
  synth(SYNTH, 'pop', 'Pop Synth', {
    attack: 0.005,
    decay: 0.6,
    sustain: 0.55,
    release: 0.25,
    gain: 0.6,
    filter: { enabled: true, base: 700, track: 1, env: 4, decay: 0.35 },
    partials: [h(1, 'saw', 0.3, -8), h(1, 'saw', 0.3, 8), h(0.5, 'square', 0.2)],
  }),
  synth(SYNTH, 'smooth', 'Smooth Synth', {
    attack: 0.06,
    decay: 1.2,
    sustain: 0.75,
    release: 0.7,
    gain: 0.75,
    filter: { enabled: true, base: 500, track: 1.2, env: 1.2, decay: 1.2 },
    partials: [h(1, 'triangle', 0.45, -4), h(1, 'triangle', 0.35, 4), h(2, 'sine', 0.12)],
  }),
  synth(SYNTH, 'pad', 'Warm Pad', {
    attack: 0.5,
    decay: 1.5,
    sustain: 0.8,
    release: 1,
    gain: 0.8,
    filter: { enabled: true, base: 350, track: 1.2, env: 0.6, decay: 2 },
    partials: [h(1, 'saw', 0.25, -9), h(1, 'saw', 0.25, 9), h(0.5, 'saw', 0.18)],
  }),
  synth(SYNTH, 'bass', 'Synth Bass', {
    attack: 0.003,
    decay: 0.5,
    sustain: 0.6,
    release: 0.08,
    gain: 0.8,
    filter: { enabled: true, base: 220, track: 0.8, env: 5, decay: 0.2 },
    partials: [h(1, 'saw', 0.4), h(0.5, 'square', 0.3)],
  }),
  synth(SYNTH, 'chip', 'Chiptune', {
    attack: 0.002,
    decay: 0.25,
    sustain: 0.6,
    release: 0.03,
    gain: 0.7,
    partials: [h(1, 'square', 0.3)],
  }),
  sampled(STRINGS, 'guitar-electric', 'Electric Guitar', pack(INSTRUMENTS + 'guitar-electric/', 'E2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6'), 0.3, 1.2),
  sampled(STRINGS, 'guitar-acoustic', 'Acoustic Guitar', pack(INSTRUMENTS + 'guitar-acoustic/', 'D2 F2 Gs2 B2 D3 F3 Gs3 B3 D4 F4 Gs4 C5'), 0.3, 1.2),
  sampled(STRINGS, 'violin', 'Violin', pack(INSTRUMENTS + 'violin/', 'G3 A3 C4 E4 G4 A4 C5 E5 G5 A5 C6 E6 G6 A6 C7'), 0.25, 1),
  sampled(STRINGS, 'cello', 'Cello', pack(INSTRUMENTS + 'cello/', 'C2 E2 G2 As2 D3 F3 Gs3 B3 D4 F4 A4 C5'), 0.3, 1),
]

const DECODE_RATE = 48_000
const MAX_SAMPLE_SECONDS = 8

async function decode(url: string, root: number): Promise<Sample> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  const buffer = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(await response.arrayBuffer())
  const length = Math.min(buffer.length, DECODE_RATE * MAX_SAMPLE_SECONDS)
  const data = new Float32Array(length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] += source[i] / buffer.numberOfChannels
  }
  return { root, rate: DECODE_RATE, data }
}

const packs = new Map<SamplePack, Promise<Sample[]>>()

export function loadPack(pack: SamplePack) {
  let samples = packs.get(pack)
  if (!samples) {
    samples = Promise.all(Object.entries(pack.samples).map(([root, file]) => decode(pack.baseUrl + file, Number(root))))
    samples.catch(() => packs.delete(pack))
    packs.set(pack, samples)
  }
  return samples
}
