import { untrack } from 'svelte'
import { normalizeTheme, type ThemePreference } from './theme'
import { engine } from './audio/engine.svelte'
import { compile, KEYMAPS, type KeyLayout } from './input/keymaps'

export const CUSTOM_KEYMAP = 'custom'
export const AUDIO_OFF = 'off'
export const RANGE_AUTO = 'auto'
export const RANGE_FULL = 'full'
export const MAX_TRANSPOSE = 11
export const WORKSPACES = ['learn', 'studio'] as const
export type Workspace = (typeof WORKSPACES)[number]

const STORAGE_KEY = 'keyfall.settings.v2'

type Stored = {
  theme: ThemePreference
  keymap: string
  custom: KeyLayout
  transpose: number
  range: string
  /** Rows of keys in Piano's Play on a phone held upright: one, or two stacked for more range. */
  keyRows: 1 | 2
  lookahead: number
  labels: boolean
  volume: number
  audioOutput: string | null
  audioBuffer: number
  audioDelay: number | null
  workspace: Workspace
  midiEnabled: boolean
  midiInput: string | null
  midiOutput: string | null
}

const DEFAULTS: Stored = {
  theme: 'system',
  keymap: KEYMAPS[0].id,
  custom: { ...KEYMAPS[0].keys },
  transpose: 0,
  range: RANGE_AUTO,
  keyRows: 1,
  lookahead: 3,
  labels: true,
  volume: 0.8,
  audioOutput: null,
  audioBuffer: 128,
  audioDelay: null,
  workspace: 'learn',
  midiEnabled: false,
  midiInput: null,
  midiOutput: null,
}

function load(): Stored {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  } catch {
    return DEFAULTS
  }
}

function save(stored: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  } catch {}
}

const presetLayout = (id: string) => (KEYMAPS.find((keymap) => keymap.id === id) ?? KEYMAPS[0]).keys

const stored = load()

class Settings {
  theme = $state(normalizeTheme(stored.theme))
  keymapId = $state(stored.keymap)
  custom = $state(stored.custom)
  transpose = $state(stored.transpose)
  range = $state(stored.range)
  keyRows = $state<1 | 2>(stored.keyRows === 2 ? 2 : 1)
  lookahead = $state(stored.lookahead)
  labels = $state(stored.labels)
  volume = $state(stored.volume)
  audioOutput = $state(stored.audioOutput)
  audioBuffer = $state(stored.audioBuffer)
  /** Calibrated milliseconds from note command to what the player hears; null uses the reported latency. */
  audioDelay = $state(stored.audioDelay)
  workspace = $state<Workspace>(stored.workspace)
  midiEnabled = $state(stored.midiEnabled)
  midiInput = $state(stored.midiInput)
  midiOutput = $state(stored.midiOutput)
  editing = $state(false)
  editTarget = $state<number | null>(null)
  outputError = $state('')

  /** Seconds auto-played notes start early so they sound as they reach the keys. */
  audioLead = $derived((this.audioDelay ?? engine.latency ?? 0) / 1000)

  keymap = $derived(compile(this.keymapId === CUSTOM_KEYMAP ? this.custom : presetLayout(this.keymapId)))

  constructor() {
    $effect.root(() => {
      $effect(() =>
        save({
          theme: this.theme,
          keymap: this.keymapId,
          custom: $state.snapshot(this.custom),
          transpose: this.transpose,
          range: this.range,
          keyRows: this.keyRows,
          lookahead: this.lookahead,
          labels: this.labels,
          volume: this.volume,
          audioOutput: this.audioOutput,
          audioBuffer: this.audioBuffer,
          audioDelay: this.audioDelay,
          workspace: this.workspace,
          midiEnabled: this.midiEnabled,
          midiInput: this.midiInput,
          midiOutput: this.midiOutput,
        }),
      )
      $effect(() => engine.setVolume(this.volume))
      $effect(() => engine.watchLatency())
      $effect(() => {
        const frames = this.audioBuffer
        untrack(() => engine.setBuffer(frames).catch((error) => (this.outputError = String(error))))
      })
      $effect(() => {
        const output = this.audioOutput
        engine.muted = output === AUDIO_OFF
        if (output === AUDIO_OFF) return
        untrack(() =>
          engine.setOutput(output).then(
            () => (this.outputError = ''),
            (error) => (this.outputError = String(error)),
          ),
        )
      })
    })
  }

  startEditing() {
    if (this.keymapId !== CUSTOM_KEYMAP) {
      this.custom = { ...presetLayout(this.keymapId) }
      this.keymapId = CUSTOM_KEYMAP
    }
    this.editing = true
    this.editTarget = null
  }

  stopEditing() {
    this.editing = false
    this.editTarget = null
  }

  bind(code: string, offset: number) {
    this.custom[code] = offset
  }

  unbind(offset: number) {
    for (const [code, bound] of Object.entries(this.custom)) if (bound === offset) delete this.custom[code]
  }

  resetCustom() {
    this.custom = { ...KEYMAPS[0].keys }
  }
}

export const settings = new Settings()
