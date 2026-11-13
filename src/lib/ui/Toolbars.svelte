<script lang="ts">
  import { layout } from './layout.svelte'
  import Toolbar, { type ToolItem } from './Toolbar.svelte'

  /** One overflowing toolbar on wide screens; on narrow ones, `second` items move to their own row. */
  let { label, items, second }: { label: string; items: ToolItem[]; second: Set<string> } = $props()
</script>

{#if layout.narrow.current}
  <div class="grid w-full gap-1.5">
    <Toolbar label={label} items={items.filter((item) => !second.has(item.id))} />
    <Toolbar label="{label} controls" items={items.filter((item) => second.has(item.id))} />
  </div>
{:else}
  <Toolbar {label} {items} />
{/if}
