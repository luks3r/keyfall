<script lang="ts" module>
  /** `shortcut` is shown in the tooltip; register the key itself with `shortcuts.use`. */
  export type ToolbarItem = { label: string; onclick: () => void; active?: boolean; disabled?: boolean; title?: string; shortcut?: string }
</script>

<script lang="ts">
  import { onMount } from 'svelte'
  import { hint } from '../device/shortcuts.svelte'
  import Button, { buttonClass } from './Button.svelte'
  import Icon from './Icon.svelte'
  import Menu from './Menu.svelte'
  import MenuItem from './MenuItem.svelte'
  import { fit } from './place'

  /**
   * One row of actions that never scrolls or wraps: what fits shows, in order, and the rest goes into a "More" menu
   * at the end. A hidden copy measures every key, so the row settles in one pass instead of flickering.
   */
  let { items, label = 'Actions' }: { items: ToolbarItem[]; label?: string } = $props()

  /** Matches `gap-1` on the row. */
  const GAP = 4

  let row: HTMLDivElement
  let ruler: HTMLDivElement
  let moreButton = $state<HTMLElement>()
  let shown = $state(Infinity)
  let open = $state(false)

  const visible = $derived(items.slice(0, shown))
  const hidden = $derived(items.slice(shown))

  function measure() {
    if (!row || !ruler) return
    const cells = [...ruler.children] as HTMLElement[]
    const more = cells.pop()?.offsetWidth ?? 0
    const style = getComputedStyle(row)
    const available = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    shown = fit(
      cells.map((c) => c.offsetWidth),
      available,
      GAP,
      more,
    )
  }

  onMount(() => {
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    observer.observe(ruler)
    return () => observer.disconnect()
  })

  // New labels can change widths without resizing the ruler as a whole.
  $effect(() => {
    void items.map((i) => i.label).join()
    queueMicrotask(measure)
  })

  $effect(() => {
    if (!hidden.length) open = false
  })
</script>

<div bind:this={row} class="relative flex min-w-0 gap-1 overflow-hidden border-t border-line px-2 py-1.5" role="group" aria-label={label}>
  {#each visible as item (item.label)}
    <Button size="sm" caps variant={item.active ? 'lit' : 'solid'} onclick={item.onclick} disabled={item.disabled} aria-pressed={item.active} title={hint(item.title ?? item.label, item.shortcut)}>{item.label}</Button>
  {/each}
  {#if hidden.length}
    <span bind:this={moreButton} class="contents">
      <Button size="sm" shape="square" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onclick={() => (open = !open)}><Icon name="more" /></Button>
    </span>
  {/if}

  <div bind:this={ruler} class="pointer-events-none invisible absolute top-0 left-0 flex gap-1 whitespace-nowrap" aria-hidden="true" inert>
    {#each items as item (item.label)}<span class={buttonClass('solid', 'sm', 'pill', true)}>{item.label}</span>{/each}
    <span class={buttonClass('solid', 'sm', 'square')}><Icon name="more" /></span>
  </div>
</div>

{#if open && moreButton}
  <Menu anchor={moreButton.firstElementChild as HTMLElement} {label} onclose={() => (open = false)}>
    {#each hidden as item (item.label)}
      <MenuItem checked={item.active} disabled={item.disabled} onclick={item.onclick}><span class="label">{item.label}</span></MenuItem>
    {/each}
  </Menu>
{/if}
