import { untrack } from 'svelte'
import { engine, LOCAL_CHANNEL, type SoundData } from './engine.svelte'
import { encodeSampler, encodeSynth, type SynthPatch } from './patch'
import { BUILT_IN, type SoundPreset, type SynthPreset } from './presets'

const STORAGE_KEY = 'keyfall.sound.v1'
const CUSTOM_PREFIX = 'custom-'

type Stored = { presetId: string; custom: SynthPreset[]; draft: SynthPatch | null }

function load(): Stored {
  const defaults: Stored = { presetId: BUILT_IN[0].id, custom: [], draft: null }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

function save(stored: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {}
}

const clone = (patch: SynthPatch): SynthPatch => structuredClone(patch)
const fallbackPatch = () => clone((BUILT_IN.find((p) => p.kind === 'synth') as SynthPreset).patch)

export const encodePreset = (preset: SoundPreset): SoundData =>
  preset.kind === 'sampled'
    ? { data: [...encodeSampler(preset.release, preset.gain)], sampled: preset.id }
    : { data: [...encodeSynth(preset.patch)], sampled: null }

const stored = load()

class Sound {
  custom = $state<SynthPreset[]>(stored.custom)
  presetId = $state(stored.presetId)
  presets = $derived<SoundPreset[]>([...BUILT_IN, ...this.custom])
  preset = $derived(this.presets.find((p) => p.id === this.presetId) ?? BUILT_IN[0])
  patch = $state<SynthPatch>(stored.draft ?? fallbackPatch())

  isCustom = $derived(this.preset.id.startsWith(CUSTOM_PREFIX))
  modified = $derived(
    this.preset.kind === 'synth' && JSON.stringify($state.snapshot(this.patch)) !== JSON.stringify(this.preset.patch),
  )

  encoded = $derived.by((): SoundData => {
    const preset = this.preset
    if (preset.kind === 'sampled') return encodePreset(preset)
    return { data: [...encodeSynth($state.snapshot(this.patch))], sampled: null }
  })

  constructor() {
    if (!stored.draft && this.preset.kind === 'synth') this.patch = clone(this.preset.patch)

    $effect.root(() => {
      $effect(() =>
        save({
          presetId: this.presetId,
          custom: $state.snapshot(this.custom),
          draft: this.preset.kind === 'synth' ? $state.snapshot(this.patch) : null,
        }),
      )
      $effect(() => {
        const sound = this.encoded
        untrack(() => engine.setSound(LOCAL_CHANNEL, sound))
      })
    })
  }

  find(id: string): SoundPreset {
    return this.presets.find((p) => p.id === id) ?? BUILT_IN[0]
  }

  select(id: string) {
    this.presetId = id
    if (this.preset.kind === 'synth') this.patch = clone(this.preset.patch)
  }

  reset() {
    if (this.preset.kind === 'synth') this.patch = clone(this.preset.patch)
  }

  saveAs(name: string) {
    const preset: SynthPreset = {
      id: CUSTOM_PREFIX + Date.now().toString(36),
      name: name.trim() || 'Untitled',
      kind: 'synth',
      patch: $state.snapshot(this.patch),
    }
    this.custom.push(preset)
    this.presetId = preset.id
  }

  save() {
    const index = this.custom.findIndex((p) => p.id === this.presetId)
    if (index >= 0) this.custom[index] = { ...this.custom[index], patch: $state.snapshot(this.patch) }
  }

  rename(name: string) {
    const preset = this.custom.find((p) => p.id === this.presetId)
    if (preset && name.trim()) preset.name = name.trim()
  }

  remove() {
    this.custom = this.custom.filter((p) => p.id !== this.presetId)
    this.select(BUILT_IN[0].id)
  }
}

export const sound = new Sound()
