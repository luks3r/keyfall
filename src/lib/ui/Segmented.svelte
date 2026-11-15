<script lang="ts" generics="T extends string | number">
  /**
   * One choice of a few, all in view: a row of keys where the chosen one is lit. Arrow keys move the choice, as in
   * any radio group. For more than about five choices, or long names, use Select or a Control instead.
   */
  let {
    value = $bindable(),
    options,
    label,
    size = 'md',
    onchange,
  }: {
    value: T
    options: { value: T; label: string }[]
    /** Names the group for screen readers. */
    label: string
    size?: 'md' | 'sm'
    onchange?: (value: T) => void
  } = $props()

  let group: HTMLDivElement

  function choose(next: T) {
    value = next
    onchange?.(next)
  }

  function onkeydown(e: KeyboardEvent) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const index = options.findIndex((o) => o.value === value)
    const next = (index + step + options.length) % options.length
    choose(options[next].value)
    group.querySelectorAll<HTMLElement>('[role=radio]')[next]?.focus()
  }
</script>

<div bind:this={group} role="radiogroup" aria-label={label} class={['flex min-w-0 gap-0.5 rounded-control bg-raised p-0.5', size === 'md' ? 'h-control' : 'h-control-sm']} {onkeydown} tabindex="-1">
  {#each options as option (option.value)}
    {@const checked = option.value === value}
    <button
      type="button"
      data-ui
      role="radio"
      aria-checked={checked}
      tabindex={checked ? 0 : -1}
      class={[
        'label h-full min-w-0 flex-auto cursor-pointer truncate rounded-control px-2 transition-colors',
        checked ? 'bg-fg text-bg' : 'text-fg hover:bg-hover',
      ]}
      onclick={() => choose(option.value)}>{option.label}</button
    >
  {/each}
</div>

<style>
  /* Lit already says chosen; the shared underline would double it. */
  [role='radio'][aria-checked='true'] {
    box-shadow: none;
  }
</style>
