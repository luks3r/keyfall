import type { Area } from './place'

/**
 * The part of the screen that is really visible, for anything that floats. Phones change it all the time: the
 * address bar slides away, and iOS lays the on-screen keyboard over the page instead of resizing it. The visual
 * viewport knows; the window does not.
 *
 * `changed` ticks on every resize, scroll, zoom or keyboard move, so placements that read it follow along.
 */
class Viewport {
  changed = $state(0)
  /** Pixels at the bottom of the window hidden behind an on-screen keyboard. */
  keyboard = $state(0)
  /** Height of the visible part of the window. */
  height = $state(typeof innerHeight === 'number' ? innerHeight : 0)

  #users = 0
  #stop = () => {}
  #probe: HTMLElement | undefined

  /** Starts watching while at least one caller needs it; returns the release for cleanup. */
  use() {
    if (this.#users++ === 0) this.#start()
    let released = false
    return () => {
      if (released) return
      released = true
      if (--this.#users === 0) this.#stop()
    }
  }

  /** The free area in window coordinates: visible, outside the notch and home bar, `margin` in from the edges. */
  area(margin = 8): Area {
    const view = visualViewport
    const top = view?.offsetTop ?? 0
    const left = view?.offsetLeft ?? 0
    const inset = this.#insets()
    return {
      top: top + inset.top + margin,
      left: left + inset.left + margin,
      right: left + (view?.width ?? innerWidth) - inset.right - margin,
      bottom: top + (view?.height ?? innerHeight) - inset.bottom - margin,
    }
  }

  #start() {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const view = visualViewport
        this.height = view?.height ?? innerHeight
        this.keyboard = view ? Math.max(0, Math.round(innerHeight - view.height - view.offsetTop)) : 0
        this.changed++
      })
    }
    const options = { capture: true, passive: true }
    addEventListener('resize', update)
    addEventListener('scroll', update, options)
    visualViewport?.addEventListener('resize', update)
    visualViewport?.addEventListener('scroll', update)
    update()
    this.#stop = () => {
      cancelAnimationFrame(frame)
      removeEventListener('resize', update)
      removeEventListener('scroll', update, options)
      visualViewport?.removeEventListener('resize', update)
      visualViewport?.removeEventListener('scroll', update)
    }
  }

  /** Safe-area insets (notch, home bar) are only readable through CSS, so a hidden element measures them. */
  #insets() {
    if (!this.#probe?.isConnected) {
      this.#probe = document.createElement('div')
      this.#probe.setAttribute('aria-hidden', 'true')
      this.#probe.style.cssText =
        'position:fixed;inset:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
      document.body.append(this.#probe)
    }
    const style = getComputedStyle(this.#probe)
    return { top: parseFloat(style.paddingTop) || 0, right: parseFloat(style.paddingRight) || 0, bottom: parseFloat(style.paddingBottom) || 0, left: parseFloat(style.paddingLeft) || 0 }
  }
}

export const viewport = new Viewport()
