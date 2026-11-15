/**
 * `use:hold={(point) => …}`: a context action every pointer can reach. A mouse right-clicks; a finger or pen presses
 * and holds still (iOS Safari sends no contextmenu for that, Android does: both end up here once). The click that
 * ends a hold is swallowed, so lifting the finger does not also press what opened under it.
 */
export type Point = { x: number; y: number }

const HOLD_MS = 500
/** A finger may wobble this far and still be holding; more is a scroll or a drag. */
const SLOP = 8
/** How long after a hold its own contextmenu event (Android) may still arrive. */
const AFTERMATH_MS = 800
/** How long after the finger lifts its click may still arrive. */
const CLICK_MS = 400

/** Events a nested hold already took, so the one around it (a clip inside its lane) stays out. */
const claimed = new WeakSet<Event>()

export type HoldAction = (point: Point, node: HTMLElement) => void

export function hold(node: HTMLElement, action: HoldAction) {
  let run = action
  let timer = 0
  let start: Point = { x: 0, y: 0 }
  let firedAt = -Infinity

  const swallow = (e: MouseEvent) => {
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  /** After a finger hold: whatever is under the finger when it lifts (often the menu just opened) gets no click. */
  const swallowLift = () => {
    const lifted = () => {
      removeEventListener('pointerup', lifted, true)
      removeEventListener('pointercancel', lifted, true)
      addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => removeEventListener('click', swallow, { capture: true }), CLICK_MS)
    }
    addEventListener('pointerup', lifted, true)
    addEventListener('pointercancel', lifted, true)
  }
  const fire = (point: Point, finger = false) => {
    firedAt = performance.now()
    if (finger) {
      navigator.vibrate?.(10)
      swallowLift()
    }
    run(point, node)
  }
  const cancel = () => {
    clearTimeout(timer)
    timer = 0
  }

  const down = (e: PointerEvent) => {
    cancel()
    if (e.pointerType === 'mouse' || !e.isPrimary || claimed.has(e)) return
    claimed.add(e)
    start = { x: e.clientX, y: e.clientY }
    timer = window.setTimeout(() => {
      timer = 0
      fire(start, true)
    }, HOLD_MS)
  }
  const move = (e: PointerEvent) => {
    if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP) cancel()
  }
  const menu = (e: MouseEvent) => {
    e.preventDefault()
    if (claimed.has(e)) return
    claimed.add(e)
    if (timer) {
      cancel()
      return fire(start, true)
    }
    if (performance.now() - firedAt < AFTERMATH_MS) return
    // The keyboard's menu key has no pointer position: open at the control instead.
    const rect = node.getBoundingClientRect()
    fire(e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: rect.left, y: rect.bottom })
  }

  node.addEventListener('pointerdown', down)
  node.addEventListener('pointermove', move)
  node.addEventListener('pointerup', cancel)
  node.addEventListener('pointercancel', cancel)
  node.addEventListener('contextmenu', menu)
  return {
    update(next: HoldAction) {
      run = next
    },
    destroy() {
      cancel()
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', cancel)
      node.removeEventListener('pointercancel', cancel)
      node.removeEventListener('contextmenu', menu)
    },
  }
}
