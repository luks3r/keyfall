<script lang="ts" module>
  /** `shortcut` is shown in the tooltip; register the key itself with `shortcuts.use`. */
  export type SoftKey = { label: string; onclick: () => void; active?: boolean; disabled?: boolean; title?: string; shortcut?: string }
</script>

<script lang="ts">
  import { hint } from './shortcuts.svelte'

  /** The display's one row of context actions; everything else lives on knobs and mode keys. */
  let { keys }: { keys: SoftKey[] } = $props()
</script>

<div class="flex min-w-0 gap-1 overflow-x-auto border-t border-line px-2 py-1.5 [scrollbar-width:none]" role="group" aria-label="Actions">
  {#each keys as key (key.label)}
    <button
      type="button"
      class={['h-8 shrink-0 cursor-pointer rounded-md px-3 font-mono text-[11px] tracking-wider uppercase disabled:opacity-35', key.active ? 'bg-fg text-bg' : 'bg-raised hover:bg-hover']}
      onclick={key.onclick}
      disabled={key.disabled}
      aria-pressed={key.active}
      title={hint(key.title ?? key.label, key.shortcut)}>{key.label}</button
    >
  {/each}
</div>
