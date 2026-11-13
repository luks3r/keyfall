import { degreeOf, LIVE_DEFAULTS, mapNote, SCALES, type LiveSettings } from './live'

export * from './live'

const STORAGE_KEY = 'keyfall.live.v1'

function load(): LiveSettings {
  try {
    return { ...LIVE_DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  } catch {
    return LIVE_DEFAULTS
  }
}

/** Live-input settings for Studio, persisted, with the derived note table shared with native input. */
class Live {
  settings = $state<LiveSettings>(load())
  /** Every input note's sounding notes; recomputed when settings change. */
  table = $derived(Array.from({ length: 128 }, (_, midi) => mapNote(midi, this.settings)))
  /** True when the map changes nothing, so native paths can skip it. */
  identity = $derived(this.table.every((notes, midi) => notes.length === 1 && notes[0] === midi))

  constructor() {
    $effect.root(() => {
      $effect(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
        } catch {}
      })
    })
  }

  map(midi: number): number[] {
    return this.table[midi] ?? [midi]
  }

  inScale(midi: number) {
    const { root, scale } = this.settings
    return degreeOf(midi, root, SCALES[scale]) !== null
  }
}

export const live = new Live()
