<script lang="ts">
  let { label, checked = $bindable() }: { label: string; checked: boolean } = $props()
</script>

<label class="flex cursor-pointer items-center justify-between gap-3 text-xs text-muted">
  {label}
  <input type="checkbox" bind:checked class="peer sr-only" />
  <span
    class="relative h-5 w-9 shrink-0 rounded-full bg-raised transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-fg after:transition-transform peer-checked:after:translate-x-4"
  ></span>
</label>
