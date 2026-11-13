<script lang="ts">
  import type { Snippet } from 'svelte'
  import { layout } from './layout.svelte'

  /**
   * Two panes with a draggable divider. `end` has the remembered size (px) and can be closed;
   * `start` takes the rest. Arrow keys resize, Enter toggles.
   */
  let {
    id,
    direction = 'row',
    size = 320,
    min = 120,
    minStart = 160,
    open = true,
    start,
    end,
  }: { id: string; direction?: 'row' | 'column'; size?: number; min?: number; minStart?: number; open?: boolean; start: Snippet; end: Snippet } = $props()

  const STEP = 24
  const HANDLE = 6

  let container: HTMLDivElement
  let total = $state(0)
  const row = $derived(direction === 'row')
  const current = $derived(Math.max(min, Math.min(layout.size(id, size), total - minStart - HANDLE)))
  const template = $derived(open ? `minmax(0, 1fr) ${HANDLE}px ${current}px` : 'minmax(0, 1fr) 0 0')

  $effect(() => {
    const observer = new ResizeObserver(([entry]) => (total = row ? entry.contentRect.width : entry.contentRect.height))
    observer.observe(container)
    return () => observer.disconnect()
  })

  function onDown(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    const rect = container.getBoundingClientRect()
    const move = (event: PointerEvent) => layout.setSize(id, row ? rect.right - event.clientX : rect.bottom - event.clientY)
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      handle.removeEventListener('lostpointercapture', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
    handle.addEventListener('lostpointercapture', up)
  }

  function onKey(e: KeyboardEvent) {
    const grow = row ? 'ArrowLeft' : 'ArrowUp'
    const shrink = row ? 'ArrowRight' : 'ArrowDown'
    if (e.key === grow || e.key === shrink) {
      e.preventDefault()
      layout.setSize(id, current + (e.key === grow ? STEP : -STEP))
    } else if (e.key === 'Enter') {
      layout.setOpen(id, !open)
    }
  }
</script>

<div bind:this={container} class="grid min-h-0 min-w-0" style={row ? `grid-template-columns: ${template}` : `grid-template-rows: ${template}`}>
  <div class="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">{@render start()}</div>
  <!-- A focusable separator with a value is the ARIA window-splitter pattern. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div
    class={['group relative z-10 touch-none', row ? 'cursor-col-resize' : 'cursor-row-resize', !open && 'hidden']}
    role="separator"
    aria-orientation={row ? 'vertical' : 'horizontal'}
    aria-valuenow={current}
    aria-valuemin={min}
    aria-valuemax={total}
    tabindex="0"
    onpointerdown={onDown}
    onkeydown={onKey}
  >
    <span class={['absolute bg-line transition-colors group-hover:bg-accent group-focus-visible:bg-accent', row ? 'inset-y-0 left-1/2 w-px' : 'inset-x-0 top-1/2 h-px']}></span>
  </div>
  <div class={['grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]', !open && 'hidden']}>{@render end()}</div>
</div>
