<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    label,
    hint = '',
    tone = 'accent',
    children,
  }: { label: string; hint?: string; tone?: 'accent' | 'danger' | 'muted'; children: Snippet } = $props()

  const TONES = { accent: 'text-accent', danger: 'text-danger', muted: 'text-muted' }
</script>

<label class="grid gap-1.5">
  <span class="flex justify-between gap-3 text-xs text-muted">
    {label}
    {#if hint}<span class={['truncate', TONES[tone]]}>{hint}</span>{/if}
  </span>
  {@render children()}
</label>
