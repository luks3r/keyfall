import { sanitizeLayout } from './adaptive'
import { MediaQuery } from 'svelte/reactivity'

export type Zone = 'side' | 'bottom'

type Stored = {
  sizes: Record<string, number>
  zones: Record<string, Zone>
  active: Partial<Record<Zone, string>>
  open: Record<string, boolean>
}

const STORAGE_KEY = 'keyfall.layout.v1'

function load(): Stored {
  const defaults: Stored = { sizes: {}, zones: {}, active: {}, open: {} }
  try {
    return sanitizeLayout(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  } catch {
    return defaults
  }
}

/** One panel that can live in a dock. `zone` is where it starts; users can move it. */
export type PanelSpec = { id: string; title: string; zone: Zone }

/**
 * Remembered workspace layout: split sizes, which dock each panel sits in, the active tab per dock and
 * which areas are open. Narrow screens fold every dock into the bottom one.
 */
class Layout {
  #stored = $state(load())
  surface = $state<'project'|'editor'|'performance'>('project')
  inspectorOpen = $state(false)
  readonly focused = new MediaQuery('(max-width: 1099px), (max-height: 759px)')
  readonly narrow = new MediaQuery('(max-width: 767px)')

  constructor() {
    $effect.root(() => {
      $effect(() => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#stored))
        } catch {}
      })
    })
  }

  size(id: string, fallback: number) {
    return this.#stored.sizes[id] ?? fallback
  }

  setSize(id: string, size: number) {
    this.#stored.sizes[id] = Math.round(size)
  }

  isOpen(id: string, fallback = true) {
    return this.#stored.open[id] ?? fallback
  }

  setOpen(id: string, open: boolean) {
    this.#stored.open[id] = open
  }

  zoneOf(panel: PanelSpec): Zone {
    return this.narrow.current ? 'bottom' : (this.#stored.zones[panel.id] ?? panel.zone)
  }

  move(panel: PanelSpec, zone: Zone) {
    this.#stored.zones[panel.id] = zone
    this.#stored.active[zone] = panel.id
    this.#stored.open[zone] = true
  }

  panelsIn(panels: PanelSpec[], zone: Zone) {
    return panels.filter((panel) => this.zoneOf(panel) === zone)
  }

  active(panels: PanelSpec[], zone: Zone) {
    const here = this.panelsIn(panels, zone)
    return here.find((panel) => panel.id === this.#stored.active[zone]) ?? here[0]
  }

  show(panels: PanelSpec[], id: string) {
    if (this.focused.current) {
      if (id === 'track') this.inspectorOpen = true
      else if (id === 'steps' || id === 'notes') this.surface = 'editor'
      else if (id === 'keyboard' || id === 'pads') this.surface = 'performance'
    }
    const panel = panels.find((p) => p.id === id)
    if (!panel) return
    const zone = this.zoneOf(panel)
    this.#stored.active[zone] = id
    this.#stored.open[zone] = true
  }
}

export const layout = new Layout()
