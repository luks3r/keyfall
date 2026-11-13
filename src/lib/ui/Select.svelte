<script lang="ts" module>
  export type Option = { value: string; label: string; group?: string }
</script>

<script lang="ts">
  let {
    value = $bindable(),
    options,
    disabled = false,
  }: { value: string; options: Option[]; disabled?: boolean } = $props()

  const groups = $derived.by(() => {
    const map = new Map<string, Option[]>()
    for (const option of options) {
      const key = option.group ?? ''
      map.set(key, [...(map.get(key) ?? []), option])
    }
    return [...map]
  })
</script>

{#snippet items(list: Option[])}
  {#each list as option (option.value)}
    <option value={option.value}>{option.label}</option>
  {/each}
{/snippet}

<select
  bind:value
  {disabled}
  class="h-9 w-full cursor-pointer truncate rounded-lg bg-raised px-2.5 text-fg transition-colors outline-none hover:enabled:bg-hover disabled:cursor-default disabled:opacity-50"
>
  {#each groups as [group, list] (group)}
    {#if group}
      <optgroup label={group}>{@render items(list)}</optgroup>
    {:else}
      {@render items(list)}
    {/if}
  {/each}
</select>
