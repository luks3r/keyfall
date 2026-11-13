<script lang="ts" generics="T extends string">
  let {
    value,
    options,
    label,
    disabled = false,
    onselect,
  }: { value: T; options: readonly T[]; label: string; disabled?: boolean; onselect: (value: T) => void } = $props()
</script>

<div role="radiogroup" aria-label={label} class="flex rounded-[10px] bg-raised p-[3px]">
  {#each options as option (option)}
    <button
      type="button"
      role="radio"
      aria-checked={value === option}
      {disabled}
      class={[
        'disabled:cursor-default disabled:opacity-50',
        'h-[26px] cursor-pointer rounded-lg px-2 capitalize transition-colors sm:px-3',
        value === option ? 'bg-hover text-fg' : 'text-muted hover:text-fg',
      ]}
      onclick={() => onselect(option)}
    >
      {option}
    </button>
  {/each}
</div>
