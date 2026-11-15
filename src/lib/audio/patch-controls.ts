import { choiceKnob, parseNumber, rangeKnob, type KnobSpec } from '../device/knob-specs'
import { WAVES, type Harmonic, type SynthPatch } from './patch'

/** The sound editor's sections, in the order they are shown and paged through. */
export const SECTIONS = [
  { id: 'voice', label: 'Voice' },
  { id: 'osc', label: 'Osc' },
  { id: 'env', label: 'Env' },
  { id: 'filter', label: 'Filter' },
  { id: 'fm', label: 'FM' },
] as const
export type SoundSection = (typeof SECTIONS)[number]['id']

/** Applies a change to the patch being edited (copying a preset first, recording undo, whatever the owner needs). */
export type Edit = (change: (patch: SynthPatch) => void) => void

export const seconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`)
/** "300 ms", "0.3 s", "300" (ms) or "1.5" (s, when below 10). */
export function parseSeconds(text: string) {
  const v = parseNumber(text)
  if (v === null) return null
  return /ms/i.test(text) || (!/s/i.test(text) && v >= 10) ? v / 1000 : v
}
export const hz = (v: number) => (v < 1000 ? `${Math.round(v)} Hz` : `${(v / 1000).toFixed(1)} kHz`)
const percent = (v: number) => `${Math.round(v * 100)}%`
const parsePercent = (text: string) => {
  const v = parseNumber(text)
  return v === null ? null : v / 100
}
const times = (v: number) => `×${Number(v.toFixed(2))}`
const onOff = (v: boolean) => (v ? 'on' : 'off')
const WAVE_NAMES: Record<string, string> = { sine: 'Sine', triangle: 'Triangle', saw: 'Saw', square: 'Square' }

/**
 * Every control of a synth patch as knob specs, shared by the sound editor and the device knobs so both show the
 * same thing. Resets go back to `original` (the preset), when there is one. Moving a filter or FM control turns
 * that stage on.
 */
export function patchControls(patch: SynthPatch, original: SynthPatch | null, edit: Edit) {
  type Options = { log?: boolean; step?: number; parse?: (text: string) => number | null }
  const knob = (label: string, min: number, max: number, read: (p: SynthPatch) => number, write: (p: SynthPatch, v: number) => void, format: (v: number) => string, options: Options = {}): KnobSpec =>
    rangeKnob(label, min, max, () => read(patch), (v) => edit((p) => write(p, v)), format, { ...options, initial: original ? read(original) : undefined })
  const toggle = (label: string, read: (p: SynthPatch) => boolean, write: (p: SynthPatch, v: boolean) => void) =>
    choiceKnob(label, [false, true], () => read(patch), (v) => edit((p) => write(p, v)), onOff, original ? read(original) : undefined)
  const time = { log: true, parse: parseSeconds }

  const oscillator = (i: number) => {
    const at = (p: SynthPatch | null) => p?.partials[i]
    const change = (write: (h: Harmonic) => void) =>
      edit((p) => {
        const h = at(p)
        if (h) write(h)
      })
    const number = (label: string, min: number, max: number, read: (h: Harmonic) => number, write: (h: Harmonic, v: number) => void, format: (v: number) => string, options: Options) => {
      const preset = at(original)
      return rangeKnob(label, min, max, () => {
        const h = at(patch)
        return h ? read(h) : min
      }, (v) => change((h) => write(h, v)), format, { ...options, initial: preset ? read(preset) : undefined })
    }
    return {
      wave: choiceKnob('Wave', WAVES, () => at(patch)?.wave ?? 'sine', (v) => change((h) => (h.wave = v)), (v) => WAVE_NAMES[v], at(original)?.wave),
      ratio: number('Ratio', 0.25, 16, (h) => h.ratio, (h, v) => (h.ratio = v), times, { step: 0.25 }),
      level: number('Level', 0, 1, (h) => h.gain, (h, v) => (h.gain = v), percent, { step: 0.01, parse: parsePercent }),
      detune: number('Detune', -50, 50, (h) => h.detune, (h, v) => (h.detune = v), (v) => `${v > 0 ? '+' : ''}${Math.round(v)}¢`, { step: 1 }),
    }
  }

  return {
    gain: knob('Gain', 0, 1.5, (p) => p.gain, (p, v) => (p.gain = v), percent, { step: 0.01, parse: parsePercent }),
    keyTrack: toggle('Key decay', (p) => p.keyTrack, (p, v) => (p.keyTrack = v)),
    attack: knob('Attack', 0.001, 2, (p) => p.attack, (p, v) => (p.attack = v), seconds, time),
    decay: knob('Decay', 0.05, 8, (p) => p.decay, (p, v) => (p.decay = v), seconds, time),
    sustain: knob('Sustain', 0, 1, (p) => p.sustain, (p, v) => (p.sustain = v), percent, { step: 0.01, parse: parsePercent }),
    release: knob('Release', 0.01, 4, (p) => p.release, (p, v) => (p.release = v), seconds, time),
    filter: toggle('Filter', (p) => p.filter.enabled, (p, v) => (p.filter.enabled = v)),
    cutoff: knob('Cutoff', 40, 12000, (p) => p.filter.base, (p, v) => ((p.filter.base = v), (p.filter.enabled = true)), hz, { log: true }),
    filterEnv: knob('Env amount', 0, 8, (p) => p.filter.env, (p, v) => ((p.filter.env = v), (p.filter.enabled = true)), (v) => v.toFixed(1), { step: 0.1 }),
    filterDecay: knob('Env decay', 0.05, 8, (p) => p.filter.decay, (p, v) => ((p.filter.decay = v), (p.filter.enabled = true)), seconds, time),
    keyFollow: knob('Key follow', 0, 8, (p) => p.filter.track, (p, v) => ((p.filter.track = v), (p.filter.enabled = true)), (v) => v.toFixed(1), { step: 0.1 }),
    fm: toggle('FM', (p) => p.fm.enabled, (p, v) => (p.fm.enabled = v)),
    fmDepth: knob('Depth', 0, 10, (p) => p.fm.index, (p, v) => ((p.fm.index = v), (p.fm.enabled = true)), (v) => v.toFixed(2), { step: 0.05 }),
    fmRatio: knob('Ratio', 0.25, 16, (p) => p.fm.ratio, (p, v) => ((p.fm.ratio = v), (p.fm.enabled = true)), times, { step: 0.25 }),
    fmDecay: knob('Decay', 0.02, 4, (p) => p.fm.decay, (p, v) => ((p.fm.decay = v), (p.fm.enabled = true)), seconds, time),
    oscillators: patch.partials.map((_, i) => oscillator(i)),
  }
}

export type PatchControls = ReturnType<typeof patchControls>

/** What the four device knobs turn in a section; Voice belongs to the owner (instrument, level). */
export function sectionKnobs(section: Exclude<SoundSection, 'voice'>, c: PatchControls, osc: number): (KnobSpec | null)[] {
  if (section === 'env') return [c.attack, c.decay, c.sustain, c.release]
  if (section === 'filter') return [c.filter, c.cutoff, c.filterEnv, c.filterDecay]
  if (section === 'fm') return [c.fm, c.fmDepth, c.fmRatio, c.fmDecay]
  const o = c.oscillators[Math.min(osc, c.oscillators.length - 1)]
  return o ? [o.wave, o.ratio, o.level, o.detune] : [null, null, null, null]
}
