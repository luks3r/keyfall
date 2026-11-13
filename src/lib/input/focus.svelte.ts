import { untrack } from 'svelte'
import { noteFocusSource, scopeForTarget, type InputScope } from './focus'
class InputFocus {
  scope = $state<InputScope>('performance')
  blocked = $state(false)
  #blocks = 0
  block() {
    this.#blocks++
    untrack(() => this.blocked = true)
    let released = false
    return () => { if (!released) { released = true; this.#blocks--; untrack(() => this.blocked = this.#blocks > 0) } }
  }
  start() {
    const sync = () => { untrack(() => this.scope = scopeForTarget(document.activeElement)) }
    addEventListener('pointerdown', noteFocusSource, true)
    addEventListener('keydown', noteFocusSource, true)
    addEventListener('focusin', sync)
    addEventListener('focusout', sync)
    sync()
    return () => {
      removeEventListener('pointerdown', noteFocusSource, true)
      removeEventListener('keydown', noteFocusSource, true)
      removeEventListener('focusin', sync)
      removeEventListener('focusout', sync)
    }
  }
}
export const inputFocus = new InputFocus()
