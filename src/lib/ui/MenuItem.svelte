<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * One row of a Menu. With `checked` it is a toggle (or, with `radio`, one choice of several) and shows a dot when
   * on; `destructive` sets it apart at the bottom in the danger colour. Pressing it closes the menu.
   */
  let {
    onclick,
    checked,
    radio = false,
    disabled = false,
    destructive = false,
    autofocus = false,
    children,
  }: { onclick: () => void; checked?: boolean; radio?: boolean; disabled?: boolean; destructive?: boolean; autofocus?: boolean; children: Snippet } = $props()

  const role = $derived(checked === undefined ? 'menuitem' : radio ? 'menuitemradio' : 'menuitemcheckbox')
</script>

<button
  type="button"
  {role}
  aria-checked={checked}
  {disabled}
  data-destructive={destructive || undefined}
  data-autofocus={autofocus || undefined}
  class={['flex items-center gap-2', checked && 'font-semibold']}
  {onclick}
>
  {#if checked !== undefined}<span class={['size-1.5 shrink-0 rounded-full', checked ? 'bg-fg' : 'bg-transparent']} aria-hidden="true"></span>{/if}
  {@render children()}
</button>
