import { inputFocus } from './focus.svelte'
import { isTyping, scopeForTarget } from './focus'
import { platform } from '../platform'
import { DEFAULT_VELOCITY, type Player } from '../player.svelte'
import { settings } from '../settings.svelte'
import { lookup, RESERVED, SHIFT } from './keymaps'

const SEEK_STEP = 5

const ACTIONS: Record<string, (player: Player) => void> = {
  Space: (p) => (p.studioKeys ? p.studioKeys.toggle() : p.toggle()),
  Enter: (p) => p.studioKeys?.record(),
  ArrowUp: (p) => p.shift(12),
  ArrowDown: (p) => p.shift(-12),
  ArrowLeft: (p) => (p.studioKeys ? p.studioKeys.step(-1) : p.seek(p.time - SEEK_STEP)),
  ArrowRight: (p) => (p.studioKeys ? p.studioKeys.step(1) : p.seek(p.time + SEEK_STEP)),
  Backspace: (p) => (p.studioKeys ? p.studioKeys.back() : p.restart()),
}

function editKey(e: KeyboardEvent) {
  e.preventDefault()
  if (e.code === 'Escape') return settings.stopEditing()
  const target = settings.editTarget
  if (target === null) return
  if (e.code === 'Backspace' || e.code === 'Delete') settings.unbind(target)
  else if (!RESERVED.has(e.code)) settings.bind(e.shiftKey && settings.keymap.shifted ? SHIFT + e.code : e.code, target)
}

const MIDI_MAX = 127

/** Keeps the native fast path playing exactly what this handler would; returns whether it sounds mapped keys. */
function syncNative(player: Player) {
  const native = { active: false }
  const keyboard = platform.keyboard
  if (!keyboard) return { native, stop: () => {} }
  let typing = $state(false)
  const focus = (e: FocusEvent) => (typing = e.type === 'focusin' && isTyping(e.target))
  addEventListener('focusin', focus)
  addEventListener('focusout', focus)
  const stopEffect = $effect.root(() => {
    $effect(() => {
      const { keys, shifted } = settings.keymap
      const root = player.root
      const notes: Record<string, number> = {}
      for (const [code, offset] of keys) if (root + offset >= 0 && root + offset <= MIDI_MAX) notes[code] = root + offset
      const enabled = !settings.editing && !typing && !inputFocus.blocked && inputFocus.scope === 'performance' && !player.studioKeys?.launchMode
      const velocity = player.studio ? (player.liveInput?.velocity ?? DEFAULT_VELOCITY) : DEFAULT_VELOCITY
      keyboard.setLayout({ enabled, shifted, velocity, notes }).then(
        (active) => (native.active = active && enabled),
        () => (native.active = false),
      )
    })
  })
  return {
    native,
    stop() {
      stopEffect()
      removeEventListener('focusin', focus)
      removeEventListener('focusout', focus)
    },
  }
}

export function bindKeyboard(player: Player) {
  const down = new Map<string, number>()
  const { native, stop } = syncNative(player)

  const releaseAll = () => {
    for (const midi of down.values()) player.release(midi)
    down.clear()
    player.setSustain(false)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || inputFocus.blocked || scopeForTarget(e.target) !== 'performance') return
    const studio = player.studioKeys
    if (e.code === 'Escape' && !settings.editing && !studio?.launchMode && e.target instanceof HTMLElement && e.target.matches('[data-performance-surface]')) {
      e.preventDefault(); e.target.blur(); return
    }
    if (studio && e.code === 'Tab' && !settings.editing && e.target instanceof HTMLElement && !!e.target.closest('[data-performance-surface]')) {
      e.preventDefault()
      return studio.toggleLaunchMode()
    }
    if (studio?.launchMode && !settings.editing) {
      if (e.repeat || studio.launchKey(e.code)) return e.preventDefault()
      const action = ACTIONS[e.code]
      if (action) {
        e.preventDefault()
        action(player)
      }
      return
    }
    const keymap = settings.keymap
    if (keymap.sustain.has(e.code)) return player.setSustain(true)
    if (settings.editing) return editKey(e)
    const offset = lookup(keymap, e.code, e.shiftKey)
    if (offset !== undefined) {
      e.preventDefault()
      if (e.repeat || down.has(e.code)) return
      const midi = player.root + offset
      down.set(e.code, midi)
      player.press(midi, undefined, native.active)
      return
    }
    const action = ACTIONS[e.code]
    if (!action) return
    e.preventDefault()
    action(player)
  }

  const onKeyUp = (e: KeyboardEvent) => {
    if (settings.keymap.sustain.has(e.code)) return player.setSustain(false)
    const midi = down.get(e.code)
    if (midi === undefined) return
    down.delete(e.code)
    player.release(midi, native.active)
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', releaseAll)

  return () => {
    stop()
    releaseAll()
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', releaseAll)
  }
}
