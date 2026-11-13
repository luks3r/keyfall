<script lang="ts">
  import type { Snippet } from 'svelte'

  /** Popover below `anchor`, kept inside the viewport. Closes on outside press, Escape or a menu item click. */
  let { anchor, onclose, children }: { anchor: HTMLElement; onclose: () => void; children: Snippet } = $props()

  const MARGIN = 8
  let menu: HTMLDivElement
  let position = $state({ top: 0, left: 0 })

  $effect(() => {
    const a = anchor.getBoundingClientRect()
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    const below = a.bottom + 4 + height <= innerHeight - MARGIN
    position = {
      top: below ? a.bottom + 4 : Math.max(MARGIN, a.top - 4 - height),
      left: Math.max(MARGIN, Math.min(a.right - width, innerWidth - width - MARGIN)),
    }
  })

  function outside(e: PointerEvent) {
    if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) onclose()
  }
</script>

<svelte:window onpointerdowncapture={outside} onkeydown={(e) => e.key === 'Escape' && onclose()} onresize={onclose} />

<div
  bind:this={menu}
  role="menu"
  tabindex="-1"
  class="fixed z-50 grid max-h-[70dvh] min-w-52 gap-0.5 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-2xl shadow-black/60"
  style:top="{position.top}px"
  style:left="{position.left}px"
  onclick={(e) => (e.target as HTMLElement).closest('[role=menuitem],[role=menuitemcheckbox]') && onclose()}
  onkeydown={() => {}}
>
  {@render children()}
</div>
