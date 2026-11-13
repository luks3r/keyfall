export const WAVES = ['sine', 'triangle', 'saw', 'square'] as const
export const MAX_PARTIALS = 8

export type Wave = (typeof WAVES)[number]
export type Harmonic = { ratio: number; wave: Wave; gain: number; detune: number }

export type SynthPatch = {
  attack: number
  decay: number
  sustain: number
  release: number
  gain: number
  keyTrack: boolean
  filter: { enabled: boolean; base: number; track: number; env: number; decay: number }
  fm: { enabled: boolean; ratio: number; index: number; decay: number }
  partials: Harmonic[]
}

const KIND_SYNTH = 0
const KIND_SAMPLER = 1

/** Layout mirrors `Instrument::decode` in crates/dsp/src/patch.rs. */
export function encodeSynth(patch: SynthPatch): Float32Array<ArrayBuffer> {
  const { filter, fm } = patch
  const partials = patch.partials.slice(0, MAX_PARTIALS)
  return Float32Array.from([
    KIND_SYNTH,
    patch.attack,
    patch.decay,
    patch.sustain,
    patch.release,
    patch.gain,
    Number(patch.keyTrack),
    Number(filter.enabled),
    filter.base,
    filter.track,
    filter.env,
    filter.decay,
    Number(fm.enabled),
    fm.ratio,
    fm.index,
    fm.decay,
    partials.length,
    ...partials.flatMap((p) => [p.ratio, WAVES.indexOf(p.wave), p.gain, p.detune]),
  ])
}

export const encodeSampler = (release: number, gain: number) => Float32Array.from([KIND_SAMPLER, release, gain])
