import { isMac } from '../platform/os'

/** Key combos like "Mod+Shift+Z": Mod is ⌘ on Mac, Ctrl elsewhere; the last part is a key name. */

const CODES: Record<string, string> = {
  '/': 'Slash',
  ',': 'Comma',
  '.': 'Period',
  '=': 'Equal',
  '-': 'Minus',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '←': 'ArrowLeft',
  '→': 'ArrowRight',
  '↑': 'ArrowUp',
  '↓': 'ArrowDown',
  Del: 'Delete',
  Esc: 'Escape',
}
const codeOf = (key: string) => CODES[key] ?? (/^[A-Z]$/.test(key) ? `Key${key}` : /^\d$/.test(key) ? `Digit${key}` : key)

const MAC_NAMES: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥', Ctrl: '⌃', Enter: '↩', Backspace: '⌫', Delete: '⌦', Del: '⌦', Escape: 'Esc' }
const PC_NAMES: Record<string, string> = { Mod: 'Ctrl', Escape: 'Esc', Delete: 'Del' }

/** "Mod+Shift+Z" as the user sees it: ⌘⇧Z on Mac, Ctrl+Shift+Z elsewhere. */
export function formatKeys(combo: string) {
  const parts = combo.split('+')
  const names = isMac ? MAC_NAMES : PC_NAMES
  return parts.map((p) => names[p] ?? p).join(isMac ? '' : '+')
}

export function matches(combo: string, e: KeyboardEvent) {
  const parts = combo.split('+')
  const key = parts.at(-1)!
  const mod = parts.includes('Mod')
  const ctrl = parts.includes('Ctrl')
  return (
    e.code === codeOf(key) &&
    e.shiftKey === parts.includes('Shift') &&
    e.altKey === parts.includes('Alt') &&
    (isMac ? e.metaKey === mod && e.ctrlKey === ctrl : e.ctrlKey === (mod || ctrl) && !e.metaKey)
  )
}

/** Title text for a control: its name and its shortcut. */
export const hint = (label: string, combo?: string) => (combo ? `${label} (${formatKeys(combo)})` : label)
