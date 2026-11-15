import { SECTIONS } from '../audio/patch-controls'
import type { Mode } from '../device/Device.svelte'

export type StudioMode = 'sound' | 'pattern' | 'perform' | 'song' | 'mix'

export const STUDIO_MODES: (Mode & { id: StudioMode })[] = [
  { id: 'sound', label: 'Sound', pages: SECTIONS.map((s) => s.label), tabs: false, form: true },
  { id: 'pattern', label: 'Pattern', pages: ['Steps', 'Notes'] },
  { id: 'perform', label: 'Perform', pages: ['Clips', 'Keys'] },
  { id: 'song', label: 'Song' },
  { id: 'mix', label: 'Mix' },
]

/** Tracks shown at once on the track keys, mixer and clip grid. */
export const BANK = 4

const STORAGE_KEY = 'keyfall.studio-ui.v1'

type Stored = { mode: StudioMode; pages: Partial<Record<StudioMode, number>> }

function load(): Stored {
  const defaults: Stored = { mode: 'perform', pages: {} }
  try {
    const stored = { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
    return STUDIO_MODES.some((m) => m.id === stored.mode) ? stored : defaults
  } catch {
    return defaults
  }
}

/** Which mode key is lit and which page each mode was left on. Pressing the lit key again turns the page. */
class StudioUi {
  #stored = $state(load())
  /** The Sound screen shows the track name as a text field. */
  renaming = $state(false)

  constructor() {
    $effect.root(() => {
      $effect(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#stored))
        } catch {}
      })
    })
  }

  get mode() {
    return this.#stored.mode
  }

  get page() {
    return this.#stored.pages[this.#stored.mode] ?? 0
  }

  press(mode: StudioMode) {
    if (mode !== this.#stored.mode) return void (this.#stored.mode = mode)
    const pages = STUDIO_MODES.find((m) => m.id === mode)?.pages?.length ?? 1
    this.#stored.pages[mode] = (this.page + 1) % pages
  }

  show(mode: StudioMode, page = 0) {
    this.#stored.mode = mode
    this.#stored.pages[mode] = page
  }
}

export const studioUi = new StudioUi()
