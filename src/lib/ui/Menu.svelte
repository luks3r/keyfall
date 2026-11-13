<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { inputFocus } from '../input/focus.svelte'
  let { anchor, point, returnFocus, onclose, children }: { anchor?: HTMLElement; point?: {x: number; y: number}; returnFocus?: HTMLElement; onclose: () => void; children: Snippet } = $props()
  let menu: HTMLDivElement
  let position = $state({ top: 0, left: 0 })
  const items = () => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')].filter(e => !e.hasAttribute('disabled'))
  $effect(() => {
    if (!menu) return
    const a = anchor?.getBoundingClientRect()
    const x = point?.x ?? a?.left ?? 8
    const y = point?.y ?? (a ? a.bottom + 4 : 8)
    position = { top: Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)), left: Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) }
  })
  onMount(() => {
    const previous = returnFocus ?? anchor ?? (document.activeElement as HTMLElement)
    const release = inputFocus.block()
    ;(items()[0] ?? menu).focus({ preventScroll: true })
    return () => { release(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  })
  function outside(e: PointerEvent) {
    if (!menu.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onclose()
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); onclose(); return }
    const list = items()
    if (['ArrowDown','ArrowUp','Home','End'].includes(e.key) && list.length) {
      e.preventDefault(); e.stopPropagation()
      const index = list.indexOf(document.activeElement as HTMLElement)
      list[e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (index + (e.key === 'ArrowUp' ? -1 : 1) + list.length) % list.length].focus()
    }
  }
</script>
<svelte:window onpointerdowncapture={outside} onresize={onclose} />
<div bind:this={menu} role="menu" tabindex="-1" data-input-scope="ui" class="fixed z-50 grid max-h-[70dvh] min-w-52 gap-0.5 overflow-y-auto rounded border border-line bg-surface p-1.5" style:top="{position.top}px" style:left="{position.left}px" onclick={(e) => (e.target as HTMLElement).closest('[role=menuitem],[role=menuitemcheckbox]') && onclose()} onkeydown={key}>
  {@render children()}
</div>
