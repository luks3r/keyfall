export type InputScope = 'performance' | 'arrangement' | 'ui'

/**
 * Who gets a key press. Text fields, menus and dialogs always take the keyboard; a focused control (button,
 * knob, tab) takes it only when it was reached with the keyboard, so clicking a button doesn't stop the computer
 * keyboard from playing notes.
 */
export function classifyScope({ editing = false, control = false, clip = false, declared }: { editing?: boolean; control?: boolean; clip?: boolean; declared?: string }): InputScope {
  if (editing || (control && !clip)) return 'ui'
  return declared === 'arrangement' ? 'arrangement' : declared === 'ui' ? 'ui' : 'performance'
}

const CONTROLS = 'button,[role="button"],[role="slider"],[role="separator"],[role="tab"],[role="menuitem"]'

/**
 * How focus last moved: by pointer (click, tap) or by keyboard (Tab). Browsers flip `:focus-visible` on any key
 * press, so it can't tell a clicked button from a tabbed-to one at keydown time; this can.
 */
let pointerFocus = false
export const focusedByKeyboard = () => !pointerFocus

/** Call from capture-phase pointerdown / keydown listeners; see `inputFocus.start`. */
export function noteFocusSource(e: PointerEvent | KeyboardEvent) {
  if (e.type === 'pointerdown') pointerFocus = true
  else if ((e as KeyboardEvent).key === 'Tab') pointerFocus = false
}

export function scopeForTarget(target: EventTarget | null): InputScope {
  if (!(target instanceof HTMLElement)) return 'performance'
  const editing = !!target.closest('input,textarea,select,[contenteditable="true"],[role="menu"],[role="dialog"]')
  const control = !!target.closest(CONTROLS) && !pointerFocus
  return classifyScope({ editing, control, clip: !!target.closest('[data-arrangement-clip]'), declared: target.closest<HTMLElement>('[data-input-scope]')?.dataset.inputScope })
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'file'])

/** True while the user types text, when no shortcut or note key should fire. */
export const isTyping = (target: EventTarget | null) =>
  (target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)) ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable)
