import { MediaQuery } from 'svelte/reactivity'

/**
 * Which of the four screen shapes the window has, from its visible size and orientation (not the device):
 *
 * - `upright`: a phone held upright, narrow and tall. Everything stacks; modes sit at the bottom edge.
 * - `sideways`: a phone turned sideways, with almost no height. Modes move to a rail at the left.
 * - `tablet`: anything between, including narrow desktop windows. The device stack, roomier.
 * - `desktop`: wide and tall. Modes on a rail, knobs inside the value cells, the inspector docked at the right.
 *
 * Control size is separate: it follows the pointer (see the control tokens in app.css).
 */
export type LayoutKind = 'upright' | 'sideways' | 'tablet' | 'desktop'

const sideways = new MediaQuery('(orientation: landscape) and (max-height: 519px)')
const upright = new MediaQuery('(max-width: 599px)')
const desktop = new MediaQuery('(min-width: 1100px) and (min-height: 700px)')

const INSPECTOR_KEY = 'keyfall.inspector.v1'
function loadInspector() {
  try {
    return localStorage.getItem(INSPECTOR_KEY) !== '0'
  } catch {
    return true
  }
}
let inspector = $state(loadInspector())

export const layout = {
  get kind(): LayoutKind {
    return sideways.current ? 'sideways' : upright.current ? 'upright' : desktop.current ? 'desktop' : 'tablet'
  },
  /** A phone in either orientation: space is short, so less used things go behind menus. */
  get phone() {
    return sideways.current || upright.current
  },
  /** Desktop: whether the docked inspector column shows (remembered; open at first). */
  get inspector() {
    return inspector
  },
  set inspector(open: boolean) {
    inspector = open
    try {
      localStorage.setItem(INSPECTOR_KEY, open ? '1' : '0')
    } catch {}
  },
}
