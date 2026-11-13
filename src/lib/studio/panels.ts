import type { PanelSpec } from '../ui/layout.svelte'

/** Studio panels. On wide screens the keyboard is its own strip; narrow screens fold it into the bottom dock. */
export const STUDIO_PANELS: PanelSpec[] = [
  { id: 'steps', title: 'Steps', zone: 'bottom' },
  { id: 'notes', title: 'Notes', zone: 'bottom' },
  { id: 'pads', title: 'Pads', zone: 'bottom' },
  { id: 'track', title: 'Track', zone: 'side' },
]
export const KEYBOARD_PANEL: PanelSpec = { id: 'keyboard', title: 'Keyboard', zone: 'bottom' }

/** Ids of the resizable areas, also used as open/closed flags. */
export const AREA = { side: 'studio-side', bottom: 'studio-bottom', keys: 'studio-keys-v2', narrow: 'studio-narrow' } as const

export type ClipEditor = 'steps' | 'notes'
