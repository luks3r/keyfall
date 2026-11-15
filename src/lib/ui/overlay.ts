import { inputFocus } from '../input/focus.svelte'

/** Focus handling shared by everything that opens over the page: panels, sheets, popovers and menus. */

const FOCUSABLE = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'

/** Controls in `root` that can take focus now (visible and enabled), in page order. */
export const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length)

/**
 * Moves focus into an overlay and keeps note keys and shortcuts out while it shows; the returned release gives focus
 * back to `returnTo` (or whatever had it), so keyboard users land where they were.
 */
export function holdFocus(root: HTMLElement, first?: HTMLElement | null, returnTo?: HTMLElement | null) {
  const previous = returnTo ?? (document.activeElement as HTMLElement | null)
  const release = inputFocus.block()
  ;(first ?? root).focus({ preventScroll: true })
  return () => {
    release()
    if (previous?.isConnected) previous.focus({ preventScroll: true })
  }
}

/** Tab and Shift+Tab go round the controls in `root` instead of leaving it. Returns whether it took the key. */
export function cycleTab(e: KeyboardEvent, root: HTMLElement) {
  if (e.key !== 'Tab') return false
  const list = focusables(root)
  e.preventDefault()
  e.stopPropagation()
  if (!list.length) return true
  const index = list.indexOf(document.activeElement as HTMLElement)
  const next = index < 0 ? (e.shiftKey ? list.length - 1 : 0) : (index + (e.shiftKey ? -1 : 1) + list.length) % list.length
  list[next].focus()
  return true
}

/** Up, Down, Home and End move between the controls in `root`, as in a menu. Returns whether it took the key. */
export function arrowFocus(e: KeyboardEvent, root: HTMLElement) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return false
  if (e.target instanceof HTMLElement && e.target.matches('input,select,textarea')) return false
  const list = focusables(root)
  if (!list.length) return false
  e.preventDefault()
  e.stopPropagation()
  const index = list.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length
  list[next].focus()
  return true
}
