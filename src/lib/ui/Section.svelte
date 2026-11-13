<script lang="ts">
  import type { Snippet } from 'svelte'

  let { title, aside, children }: { title: string; aside?: Snippet; children: Snippet } = $props()
</script>

<section class="grid gap-3.5">
  <div class="flex min-h-5 items-center justify-between gap-3">
    <h3 class="text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h3>
    {@render aside?.()}
  </div>
  {@render children()}
</section>
