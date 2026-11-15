<script lang="ts" module>
  /** Narrower than this, popovers open as a sheet from the bottom edge: full width, in reach of the thumb. */
  export const SHEET_QUERY = '(max-width: 639px)'
</script>

<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import type { ClassValue } from 'svelte/elements'
  import { MediaQuery } from 'svelte/reactivity'
  import { fade, fly } from 'svelte/transition'
  import { arrowFocus, cycleTab, focusables, holdFocus } from './overlay'
  import { place, type Align, type Side } from './place'
  import { viewport } from './viewport.svelte'

  /**
   * Content that floats over the page, tied to what opened it: beside `anchor` (or at `point`, for context menus),
   * flipped and shifted to stay on screen and above an on-screen keyboard. On a phone it is a bottom sheet instead,
   * since a narrow screen has no room beside anything.
   *
   * Opens with a short motion and closes at once: a closing menu that lingers still catches presses.
   *
   * Takes focus while open (the first `[data-autofocus]`, else the first control) and gives it back on close. Escape,
   * a press outside, or a tap on the sheet's backdrop close it. `role="menu"` adds arrow-key movement.
   */
  let {
    anchor,
    point,
    returnFocus,
    side = 'bottom',
    align = 'start',
    sheet = 'auto',
    role = 'dialog',
    label,
    class: className,
    onclose,
    children,
  }: {
    anchor?: HTMLElement
    point?: { x: number; y: number }
    returnFocus?: HTMLElement
    side?: Side
    align?: Align
    /** `auto` is a sheet on narrow screens only. */
    sheet?: boolean | 'auto'
    role?: 'dialog' | 'menu'
    /** Names it for screen readers; a sheet shows it as its title. */
    label?: string
    class?: ClassValue
    onclose: () => void
    children: Snippet
  } = $props()

  const narrow = new MediaQuery(SHEET_QUERY)
  const asSheet = $derived(sheet === 'auto' ? narrow.current : sheet)

  let box = $state<HTMLDivElement>()
  let size = $state({ width: 0, height: 0 })
  let position = $state({ top: 0, left: 0, maxWidth: 0, maxHeight: 0 })

  $effect(() => {
    if (asSheet || !box) return
    void viewport.changed
    const area = viewport.area()
    const rect = anchor?.getBoundingClientRect()
    const from = point ? { top: point.y, left: point.x, width: 0, height: 0 } : rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : { top: area.top, left: area.left, width: 0, height: 0 }
    position = place(from, size, area, { side, align })
  })

  onMount(() => {
    const stopViewport = viewport.use()
    size = { width: box!.scrollWidth, height: box!.scrollHeight }
    const observer = new ResizeObserver(() => box && (size = { width: box.scrollWidth, height: box.scrollHeight }))
    observer.observe(box!)
    const release = holdFocus(box!, box!.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(box!)[0], returnFocus ?? anchor)
    return () => {
      observer.disconnect()
      stopViewport()
      release()
    }
  })

  /** Popover only: a press anywhere else closes it (and still does what it pressed). The anchor toggles itself. */
  function outside(e: PointerEvent) {
    if (asSheet || !box) return
    const target = e.target as Node
    if (!box.contains(target) && !anchor?.contains(target)) onclose()
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      return onclose()
    }
    if (cycleTab(e, box!)) return
    if (role === 'menu') arrowFocus(e, box!)
  }

  // The anchor may scroll away or be removed (a list re-rendered): then the popover has nothing to point at.
  $effect(() => {
    void viewport.changed
    if (anchor && !anchor.isConnected) onclose()
  })
</script>

<svelte:window onpointerdowncapture={outside} />

{#if asSheet}
  <!-- The backdrop closes on click, not press: the finger's lift must not land on what lies under it. -->
  <div class="fixed inset-0 z-40 bg-black/40" in:fade={{ duration: 150 }} onclick={onclose} aria-hidden="true"></div>
{/if}
<div
  bind:this={box}
  {role}
  tabindex="-1"
  aria-label={label}
  aria-modal={asSheet ? true : undefined}
  data-input-scope="ui"
  data-presentation={asSheet ? 'sheet' : 'popover'}
  class={[
    'fixed z-50 grid content-start gap-0.5 overflow-x-hidden overflow-y-auto overscroll-contain border border-line bg-surface p-1.5 outline-none',
    asSheet ? 'inset-x-0 rounded-t-surface border-b-0 pb-[max(env(safe-area-inset-bottom),0.5rem)]' : 'w-max min-w-52 rounded-control shadow-lg shadow-black/30',
    className,
  ]}
  style:top={asSheet ? undefined : `${position.top}px`}
  style:left={asSheet ? undefined : `${position.left}px`}
  style:max-width={asSheet ? undefined : `${position.maxWidth}px`}
  style:max-height={asSheet ? `${Math.round(viewport.height * 0.85)}px` : `${position.maxHeight}px`}
  style:bottom={asSheet ? `${viewport.keyboard}px` : undefined}
  in:fly={asSheet ? { y: 48, duration: 200 } : { y: -4, duration: 120 }}
  {onkeydown}
>
  {#if asSheet}
    <div class="mx-auto mt-0.5 mb-1.5 h-1 w-9 shrink-0 rounded-full bg-line" aria-hidden="true"></div>
    {#if label}<div class="label px-3 pb-1 text-muted">{label}</div>{/if}
  {/if}
  {@render children()}
</div>
