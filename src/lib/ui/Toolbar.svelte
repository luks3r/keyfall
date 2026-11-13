<script lang="ts" module>
  import type { Snippet } from 'svelte'
  import type { IconName } from './Icon.svelte'

  /**
   * One toolbar entry. Higher `priority` stays visible longer; `Infinity` never moves into the overflow menu.
   * Actions render themselves both inline and in the menu; custom `content` needs a `menu` snippet to be hideable.
   */
  export type ToolItem =
    | { id: string; spacer: true }
    | {
        id: string
        priority?: number
        label: string
        icon?: IconName
        onclick?: () => void
        active?: boolean
        disabled?: boolean
        text?: string
        content?: Snippet
        menu?: Snippet
      }
</script>

<script lang="ts">
  import Button from './Button.svelte'
  import Icon from './Icon.svelte'
  import Menu from './Menu.svelte'

  let { items, label }: { items: ToolItem[]; label: string } = $props()

  const GAP = 4
  const MORE = 36

  let width = $state(0)
  let widths = $state<Record<string, number>>({})
  let open = $state(false)
  let more = $state<HTMLElement>()

  type Item = Exclude<ToolItem, { spacer: true }>
  const isSpacer = (item: ToolItem): item is { id: string; spacer: true } => 'spacer' in item
  const hideable = (item: Item) => (item.priority ?? 0) !== Infinity && (!item.content || !!item.menu)

  const hidden = $derived.by(() => {
    const entries = items.filter((item): item is Item => !isSpacer(item))
    let used = entries.reduce((sum, item) => sum + (widths[item.id] ?? 0) + GAP, 0)
    const result = new Set<string>()
    if (used <= width) return result
    used += MORE
    const candidates = entries.filter(hideable).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
    for (const item of candidates) {
      if (used <= width) break
      result.add(item.id)
      used -= (widths[item.id] ?? 0) + GAP
    }
    return result
  })
  const overflow = $derived(items.filter((item): item is Item => !isSpacer(item) && hidden.has(item.id)))

  function measure(node: HTMLElement, id: string) {
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => (widths[id] = node.offsetWidth))
    })
    observer.observe(node)
    return { destroy: () => (observer.disconnect(), cancelAnimationFrame(frame)) }
  }
</script>

<div role="toolbar" aria-label={label} class="flex min-w-0 flex-1 items-center gap-1" bind:clientWidth={width}>
  {#each items as item (item.id)}
    {#if isSpacer(item)}
      <span class="min-w-0 flex-1"></span>
    {:else if !hidden.has(item.id)}
      <div class="flex shrink-0 items-center" use:measure={item.id}>
        {#if item.content}
          {@render item.content()}
        {:else}
          <Button
            variant="ghost"
            shape={item.text ? 'pill' : 'square'}
            class={item.active ? 'bg-accent/20 text-accent' : ''}
            onclick={item.onclick}
            disabled={item.disabled}
            title={item.label}
            aria-label={item.label}
            aria-pressed={item.active}
          >
            {#if item.icon}<Icon name={item.icon} />{/if}{item.text ?? ''}
          </Button>
        {/if}
      </div>
    {/if}
  {/each}
  {#if overflow.length}
    <span bind:this={more} class="shrink-0">
      <Button variant="ghost" shape="square" onclick={() => (open = !open)} aria-label="More" aria-expanded={open} title="More">
        <svg viewBox="0 0 24 24" class="size-[18px] fill-current" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </Button>
    </span>
  {/if}
</div>

{#if open && more && overflow.length}
  <Menu anchor={more} onclose={() => (open = false)}>
    {#each overflow as item (item.id)}
      {#if item.menu}
        <div class="px-1 py-1">{@render item.menu()}</div>
      {:else}
        <button
          type="button"
          role={item.active === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.active}
          class="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left hover:bg-raised disabled:cursor-default disabled:opacity-40"
          disabled={item.disabled}
          onclick={item.onclick}
        >
          {#if item.icon}<Icon name={item.icon} class={item.active ? 'text-accent' : 'text-muted'} />{/if}
          <span class="flex-1">{item.label}</span>
          {#if item.active}<span class="size-1.5 rounded-full bg-accent"></span>{/if}
        </button>
      {/if}
    {/each}
  </Menu>
{/if}
