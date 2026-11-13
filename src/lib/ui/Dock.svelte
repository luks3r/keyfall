<script lang="ts">
  import type { Snippet } from 'svelte'
  import Button from './Button.svelte'
  import Icon from './Icon.svelte'
  import { studio } from '../studio/studio.svelte'
  import { layout, type PanelSpec, type Zone } from './layout.svelte'
  import Menu from './Menu.svelte'

  /** Tabbed area for the panels currently docked in `zone`. Panels can be moved to the other dock on wide screens. */
  let { zone, panels, panel, onclose }: { zone: Zone; panels: PanelSpec[]; panel: Snippet<[PanelSpec]>; onclose?: () => void } = $props()

  const here = $derived(layout.panelsIn(panels, zone))
  const active = $derived(layout.active(panels, zone))
  const other: Zone = $derived(zone === 'side' ? 'bottom' : 'side')

  let menuFor = $state<{ panel: PanelSpec; anchor: HTMLElement } | null>(null)
</script>

<section class="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-surface" aria-label="{zone} panels">
  <div role="tablist" class="flex min-w-0 items-center gap-1 overflow-x-auto px-2 pt-1.5 [scrollbar-width:none]">
    {#each here as item (item.id)}
      <button
        type="button"
        role="tab"
        aria-selected={active?.id === item.id}
        class={['h-8 shrink-0 cursor-pointer rounded-lg px-3 text-sm', active?.id === item.id ? 'bg-raised text-fg' : 'text-muted hover:text-fg']}
        onclick={() => { if (item.id === 'steps' || item.id === 'notes') studio.clipEditor = item.id; layout.show(panels, item.id) }}
        oncontextmenu={(e) => {
          if (layout.narrow.current) return
          e.preventDefault()
          menuFor = { panel: item, anchor: e.currentTarget }
        }}>{item.title}</button
      >
    {/each}
    <span class="flex-1"></span>
    {#if active && !layout.narrow.current}
      <Button
        variant="ghost"
        shape="square"
        onclick={(e: MouseEvent) => (menuFor = { panel: active, anchor: e.currentTarget as HTMLElement })}
        title="Panel options"
        aria-label="Panel options"
      >
        <Icon name={zone === 'side' ? 'dock-bottom' : 'dock-side'} />
      </Button>
    {/if}
    {#if onclose}
      <Button variant="ghost" shape="square" onclick={onclose} title="Hide panels" aria-label="Hide panels"><Icon name="close" /></Button>
    {/if}
  </div>
  <div class="grid min-h-0 min-w-0">
    {#if active}{@render panel(active)}{/if}
  </div>
</section>

{#if menuFor}
  <Menu anchor={menuFor.anchor} onclose={() => (menuFor = null)}>
    <button type="button" role="menuitem" class="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-raised" onclick={() => menuFor && layout.move(menuFor.panel, other)}>
      <Icon name={other === 'side' ? 'dock-side' : 'dock-bottom'} class="text-muted" />Move “{menuFor.panel.title}” to {other === 'side' ? 'side' : 'bottom'}
    </button>
  </Menu>
{/if}
