import { focusedByKeyboard } from '../input/focus'
import { KNOB_COARSE, nudge, reset, setTo, type KnobSpec } from './knob-specs'

const NUDGES: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: KNOB_COARSE, PageDown: -KNOB_COARSE }
const TYPING = /^[\d.+-]$/

/**
 * Keys on a focused knob or value: arrows and PageUp/PageDown turn it (Shift for fine), Home/End go to the ends.
 * Reached with the keyboard, Delete resets, Enter or Space opens it and typing a number starts entering one; a
 * clicked control leaves those keys to the piano.
 */
export function valueKeys(e: KeyboardEvent, spec: KnobSpec, open: (draft: string | null) => void) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
  const take = () => (e.preventDefault(), e.stopPropagation())
  const notches = NUDGES[e.key]
  if (notches) return take(), nudge(spec, notches, e.shiftKey)
  if (e.key === 'Home' || e.key === 'End') return take(), setTo(spec, e.key === 'Home' ? 0 : 1)
  if (!focusedByKeyboard()) return
  if (e.key === 'Delete' || e.key === 'Backspace') take(), reset(spec)
  else if (e.key === 'Enter' || e.key === ' ') take(), open(null)
  else if (!spec.options && spec.parse && TYPING.test(e.key)) take(), open(e.key)
}
