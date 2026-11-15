import { nudge, setTo, type KnobSpec } from './knob-specs'

/** Movement under this many pixels is still a tap; fingers wobble more than mice. */
const SLOP = { mouse: 3, pen: 4, touch: 8 } as Record<string, number>
/** Travel per choice: the range split evenly, within these bounds. */
const CHOICE_PX = { min: 14, max: 24 }
/** Pixels of wheel or trackpad travel per notch. */
const WHEEL_NOTCH = 40
const LINE_PIXELS = 16
const FINE = 0.25

export type DragOptions = {
  /** Pixels of travel for the whole range. */
  range: number
  /** Which way turns it up: right, up, or either. */
  axis?: 'x' | 'y' | 'both'
  /** Called when the press ends without moving. */
  tap?: () => void
}

/**
 * Turns `spec` while the pointer moves: right or up turns it up, from wherever the press started (no jump to the
 * pointer). Shift turns finer. Choice knobs click through choices at even distances.
 */
export function dragSpec(e: PointerEvent, spec: KnobSpec, { range, axis = 'both', tap }: DragOptions) {
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)
  const slop = SLOP[e.pointerType] ?? SLOP.mouse
  const start = { x: e.clientX, y: e.clientY }
  let last = start
  let moved = false
  let pending = 0
  // Kept unrounded, so a stepped value still follows slow movement.
  let unit = spec.value()
  const choice = spec.steps ? Math.min(CHOICE_PX.max, Math.max(CHOICE_PX.min, range / (spec.steps - 1))) / range : 0

  const move = (event: PointerEvent) => {
    if (!moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) < slop) return
    moved = true
    const dx = axis === 'y' ? 0 : event.clientX - last.x
    const dy = axis === 'x' ? 0 : last.y - event.clientY
    last = { x: event.clientX, y: event.clientY }
    const delta = ((dx + dy) / range) * (event.shiftKey ? FINE : 1)
    if (!choice) {
      unit = Math.max(0, Math.min(1, unit + delta))
      return setTo(spec, unit)
    }
    pending += delta
    while (Math.abs(pending) >= choice) {
      nudge(spec, Math.sign(pending))
      pending -= Math.sign(pending) * choice
    }
  }
  const end = (event: PointerEvent) => {
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', end)
    target.removeEventListener('pointercancel', end)
    if (!moved && event.type === 'pointerup') tap?.()
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', end)
  target.addEventListener('pointercancel', end)
}

/** Mouse wheels click by notches; trackpads send small deltas that add up to notches. One per control. */
export function wheelTurner() {
  let travel = 0
  return (e: WheelEvent, spec: KnobSpec) => {
    e.preventDefault()
    const delta = e.deltaMode === 1 ? e.deltaY * LINE_PIXELS : e.deltaY
    travel = Math.sign(travel) === Math.sign(delta) ? travel + delta : delta
    if (Math.abs(delta) >= WHEEL_NOTCH) travel = Math.sign(delta) * WHEEL_NOTCH
    while (Math.abs(travel) >= WHEEL_NOTCH) {
      nudge(spec, -Math.sign(travel), e.shiftKey)
      travel -= Math.sign(travel) * WHEEL_NOTCH
    }
  }
}
