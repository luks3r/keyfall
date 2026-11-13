import { untrack } from 'svelte'
import { settings } from './settings.svelte'
import { resolveTheme, type ResolvedTheme } from './theme'

class Theme {
  current = $state<ResolvedTheme>('dark')
  revision = $state(0)
  start() {
    const media = matchMedia('(prefers-color-scheme: dark)')
    let dark = $state(media.matches)
    const change = () => { dark = media.matches }
    media.addEventListener('change', change)
    const stop = $effect.root(() => {
      $effect(() => {
        this.current = resolveTheme(settings.theme, dark)
        document.documentElement.dataset.theme = this.current
        document.documentElement.style.colorScheme = this.current
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.current === 'light' ? '#e8e7e2' : '#141514')
        untrack(() => this.revision++)
      })
    })
    return () => { stop(); media.removeEventListener('change', change) }
  }
}
export const theme = new Theme()
export function readCanvasPalette(element: HTMLElement) {
  const styles = getComputedStyle(element)
  const read = (name: string) => styles.getPropertyValue(`--color-${name}`).trim()
  return {
    bg: read('display'), lane: read('grid-faint'), octave: read('grid'), line: read('playhead'),
    white: read('key-white'), black: read('key-black'), seam: read('key-seam'),
    labelOnWhite: read('key-label-white'), labelOnBlack: read('key-label-black'),
    user: read('mint'), edit: read('danger'),
    hands: [[read('hand-left'), read('hand-left-dark')], [read('hand-right'), read('hand-right-dark')]],
  }
}
