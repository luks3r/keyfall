<script lang="ts">
  import type { Snippet } from 'svelte'

  let { children }: { children: Snippet } = $props()
</script>

<kbd class="mx-px rounded bg-raised px-1.5 py-px font-sans text-[0.85em]">{@render children()}</kbd>
