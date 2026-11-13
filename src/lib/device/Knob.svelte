<script lang="ts">
  import { focusedByKeyboard } from '../input/focus'
  import { controls } from '../studio/controls.svelte'
  import Menu from '../ui/Menu.svelte'
  import { KNOB_COARSE, knobs, KNOB_KEYS, type KnobColor } from './knobs.svelte'

  /**
   * One of the four device knobs. Drag up/down (Shift for fine) or scroll to turn; double-click, Alt-click or
   * Delete resets; Enter or typing a number enters a value; right-click for the menu (reset, type, MIDI learn).
   */
  let { index, color }: { index: number; color: KnobColor } = $props()

  const DRAG_RANGE = 180
  const DRAG_SLOP = 2
  /** Pixels of wheel or trackpad travel per notch. */
  const WHEEL_NOTCH = 40
  const LINE_PIXELS = 16
  const ARC = 270
  const TYPING = /^[\d.+-]$/

  const spec = $derived(knobs.specs[index])
  const value = $derived(spec?.value() ?? 0)
  const angle = $derived(-ARC / 2 + value * ARC)
  const keys = $derived(KNOB_KEYS[index].map((code) => code.replace('Key', '')).join('/'))
  const cc = $derived(controls.knobCCs[index] ?? null)
  const learning = $derived(controls.learnKnob === index)

  let element = $state<HTMLDivElement>()
  let menu = $state<{ x: number; y: number } | null>(null)
  let wheelTravel = 0

  function down(e: PointerEvent) {
    if (!spec || e.button !== 0) return
    if (e.altKey || e.metaKey || e.ctrlKey) return knobs.reset(index)
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const start = e.clientY
    let last = e.clientY
    let moved = false
    let pending = 0
    const move = (event: PointerEvent) => {
      if (!moved && Math.abs(event.clientY - start) < DRAG_SLOP) return
      moved = true
      const delta = (last - event.clientY) / DRAG_RANGE
      last = event.clientY
      if (spec.steps) {
        pending += delta
        const step = 1 / Math.max(4, spec.steps - 1)
        while (Math.abs(pending) >= step) {
          knobs.nudge(index, Math.sign(pending))
          pending -= Math.sign(pending) * step
        }
      } else {
        knobs.turn(index, delta * (event.shiftKey ? 0.25 : 1))
      }
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  /** Mouse wheels click by notches; trackpads send small deltas that add up to notches. */
  function wheel(e: WheelEvent) {
    if (!spec) return
    e.preventDefault()
    const delta = e.deltaMode === 1 ? e.deltaY * LINE_PIXELS : e.deltaY
    wheelTravel = Math.sign(wheelTravel) === Math.sign(delta) ? wheelTravel + delta : delta
    if (Math.abs(delta) >= WHEEL_NOTCH) wheelTravel = Math.sign(delta) * WHEEL_NOTCH
    while (Math.abs(wheelTravel) >= WHEEL_NOTCH) {
      knobs.nudge(index, -Math.sign(wheelTravel), e.shiftKey)
      wheelTravel -= Math.sign(wheelTravel) * WHEEL_NOTCH
    }
  }

  const NUDGES: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: KNOB_COARSE, PageDown: -KNOB_COARSE }

  function key(e: KeyboardEvent) {
    if (!spec || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
    const notches = NUDGES[e.key]
    if (notches) {
      e.preventDefault()
      e.stopPropagation()
      return knobs.nudge(index, notches, e.shiftKey)
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      e.stopPropagation()
      return knobs.set(index, e.key === 'Home' ? 0 : 1)
    }
    // Reset and typing are for a knob reached with the keyboard; a clicked knob leaves those keys to the piano.
    if (!focusedByKeyboard()) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      knobs.reset(index)
    } else if (e.key === 'Enter' || TYPING.test(e.key)) {
      e.preventDefault()
      e.stopPropagation()
      knobs.type(index, e.key === 'Enter' ? null : e.key)
    }
  }

  function context(e: MouseEvent) {
    e.preventDefault()
    menu = { x: e.clientX, y: e.clientY }
  }
</script>

<div class={['knob grid justify-items-center gap-1', !spec && 'opacity-30']} style:--knob="var(--color-knob-{color})">
  <div
    bind:this={element}
    class={['relative size-11 cursor-ns-resize touch-none rounded-full', learning && 'animate-pulse']}
    role="slider"
    tabindex={spec ? 0 : -1}
    aria-label={spec ? spec.label : `Knob ${index + 1} (unused)`}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(value * 100)}
    aria-valuetext={spec?.display()}
    title={spec ? `${spec.label} · drag or scroll · double-click to reset · Alt+${keys}` : undefined}
    onpointerdown={down}
    ondblclick={() => knobs.reset(index)}
    oncontextmenu={context}
    onwheel={wheel}
    onkeydown={key}
  >
    <svg viewBox="0 0 44 44" class="size-11" aria-hidden="true">
      <circle cx="22" cy="22" r="19" class="fill-[var(--knob)]" />
      <circle cx="22" cy="22" r="13" class="fill-[var(--color-knob-cap)]" />
      <line x1="22" y1="22" x2="22" y2="11" class="stroke-[var(--color-knob-mark)] [stroke-linecap:round] [stroke-width:3]" transform="rotate({angle} 22 22)" />
    </svg>
  </div>
</div>

{#if menu}
  <Menu point={menu} returnFocus={element} onclose={() => (menu = null)}>
    <button type="button" role="menuitem" disabled={spec?.initial === undefined} onclick={() => knobs.reset(index)}>Reset</button>
    <button type="button" role="menuitem" disabled={!spec} onclick={() => knobs.type(index)}>Type a value…</button>
    {#if learning}
      <button type="button" role="menuitem" onclick={() => (controls.learnKnob = null)}>Cancel MIDI learn</button>
    {:else}
      <button type="button" role="menuitem" onclick={() => (controls.learnKnob = index)}>Learn MIDI knob{cc === null ? '' : ` (now CC ${cc})`}</button>
    {/if}
    {#if cc !== null}
      <button type="button" role="menuitem" onclick={() => controls.forgetKnob(index)}>Forget CC {cc}</button>
    {/if}
  </Menu>
{/if}
