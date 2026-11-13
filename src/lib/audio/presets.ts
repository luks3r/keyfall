import type { Sample } from '../platform/types'
import type { Harmonic, SynthPatch, Wave } from './patch'

export type SamplePack = { baseUrl: string; samples: Record<number, string> }

export type SynthPreset = { id: string; name: string; kind: 'synth'; patch: SynthPatch }
export type SampledPreset = { id: string; name: string; kind: 'sampled'; pack: SamplePack; release: number; gain: number }
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

const synth = (id: string, name: string, patch: Partial<SynthPatch>): SynthPreset => ({
  id,
  name,
  kind: 'synth',
  patch: { ...BASE, ...patch },
})

const SALAMANDER_NAMES: Record<number, string> = { 0: 'C', 3: 'Ds', 6: 'Fs', 9: 'A' }
const salamander: Record<number, string> = {}
for (let midi = 21; midi <= 108; midi += 3) salamander[midi] = `${SALAMANDER_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}.mp3`

export const BUILT_IN: SoundPreset[] = [
  synth('piano', 'Soft Piano', {
    decay: 2.2,
    keyTrack: true,
    filter: { enabled: true, base: 300, track: 1.5, env: 4, decay: 1 },
    partials: [h(1, 'triangle', 0.55), h(1, 'sine', 0.35, 5), h(2, 'sine', 0.22, -4), h(3, 'sine', 0.07, 3), h(4, 'sine', 0.03)],
  }),
  synth('epiano', 'Electric Piano', {
    attack: 0.002,
    decay: 1.8,
    release: 0.12,
    keyTrack: true,
    fm: { enabled: true, ratio: 1, index: 1.6, decay: 0.35 },
    partials: [h(1, 'sine', 0.8), h(2, 'sine', 0.12, 2)],
  }),
  synth('organ', 'Organ', {
    attack: 0.008,
    sustain: 1,
    release: 0.04,
    gain: 0.7,
    partials: [h(0.5, 'sine', 0.4), h(1, 'sine', 0.55), h(2, 'sine', 0.35), h(3, 'sine', 0.2), h(4, 'sine', 0.15), h(8, 'sine', 0.06)],
  }),
  synth('pad', 'Warm Pad', {
    attack: 0.5,
    decay: 1.5,
    sustain: 0.8,
    release: 1,
    gain: 0.8,
    filter: { enabled: true, base: 350, track: 1.2, env: 0.6, decay: 2 },
    partials: [h(1, 'saw', 0.25, -9), h(1, 'saw', 0.25, 9), h(0.5, 'saw', 0.18)],
  }),
  synth('chip', 'Chiptune', {
    attack: 0.002,
    decay: 0.25,
    sustain: 0.6,
    release: 0.03,
    gain: 0.7,
    partials: [h(1, 'square', 0.3)],
  }),
  synth('marimba', 'Marimba', {
    attack: 0.002,
    decay: 0.35,
    release: 0.1,
    keyTrack: true,
    partials: [h(1, 'sine', 0.85), h(4, 'sine', 0.18), h(10, 'sine', 0.04)],
  }),
  {
    id: 'grand',
    name: 'Grand Piano',
    kind: 'sampled',
    pack: { baseUrl: 'https://tonejs.github.io/audio/salamander/', samples: salamander },
    release: 0.25,
    gain: 1.4,
  },
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
