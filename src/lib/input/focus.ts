export type InputScope = 'performance' | 'arrangement' | 'ui'
export function classifyScope({ editing = false, control = false, clip = false, declared }: { editing?: boolean; control?: boolean; clip?: boolean; declared?: string }): InputScope {
  if (editing || (control && !clip)) return 'ui'
  return declared === 'arrangement' ? 'arrangement' : declared === 'ui' ? 'ui' : 'performance'
}
export function scopeForTarget(target: EventTarget | null): InputScope {
  if (!(target instanceof HTMLElement)) return 'performance'
  const editing = !!target.closest('input,textarea,select,[contenteditable="true"],[role="menu"],[role="dialog"]')
  return classifyScope({ editing, control: !!target.closest('button,[role="button"],[role="slider"],[role="separator"],[role="tab"]'), clip: !!target.closest('[data-arrangement-clip]'), declared: target.closest<HTMLElement>('[data-input-scope]')?.dataset.inputScope })
}
