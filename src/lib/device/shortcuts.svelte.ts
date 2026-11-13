import { untrack } from 'svelte'
import { isTyping } from '../input/focus'
import { inputFocus } from '../input/focus.svelte'
import { matches } from './combo'

export * from './combo'

/**
 * Keyboard shortcuts by layer: the app registers general ones, each screen adds its own while it shows. Later layers
 * win, so a screen can take over a key. Entries without `run` only document keys handled elsewhere (note keys,
 * Space, arrows) so the shortcuts sheet lists everything in one place.
 *
 * `keys` are combos like "Mod+Shift+Z" (Mod is ⌘ on Mac, Ctrl elsewhere); the last part is a key name.
 */
export type Shortcut = { keys: string[]; label: string; run?: (e: KeyboardEvent) => void; when?: () => boolean }
export type ShortcutGroup = { title: string; items: Shortcut[] }

class Shortcuts {
  groups = $state.raw<ShortcutGroup[]>([])

  /** Adds a layer while a screen shows; returns its release for `$effect` cleanup. */
  use(title: string, items: Shortcut[]) {
    const group = { title, items }
    untrack(() => (this.groups = [...this.groups, group]))
    return () => untrack(() => (this.groups = this.groups.filter((g) => g !== group)))
  }

  /** Runs the newest matching shortcut; returns whether one ran. */
  handle(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing || inputFocus.blocked || isTyping(e.target)) return false
    for (let g = this.groups.length - 1; g >= 0; g--) {
      for (const item of this.groups[g].items) {
        if (!item.run || !item.keys.some((combo) => matches(combo, e)) || (item.when && !item.when())) continue
        e.preventDefault()
        item.run(e)
        return true
      }
    }
    return false
  }
}

export const shortcuts = new Shortcuts()
