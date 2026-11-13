<script lang="ts">
  import type { Snippet } from 'svelte'
  import { MediaQuery } from 'svelte/reactivity'
  import { fly } from 'svelte/transition'
  import Button from './Button.svelte'
  import Icon from './Icon.svelte'

  let {
    title,
    modal = true,
    width = 320,
    actions,
    children,
    onclose,
  }: { title: string; modal?: boolean; width?: number; actions?: Snippet; children: Snippet; onclose: () => void } = $props()

  const phone = new MediaQuery('max-width: 639px')
</script>

<svelte:window onkeydown={(e) => e.code === 'Escape' && onclose()} />

{#if modal}
  <div class="fixed inset-0 z-10 bg-black/30" onpointerdown={onclose} aria-hidden="true"></div>
{/if}
<aside
  transition:fly={phone.current ? { y: modal ? 48 : -48, duration: 200 } : { x: 24, duration: 160 }}
  style:--panel-width="min({width}px, calc(100vw - 16px))"
  class={[
    'fixed z-20 flex flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain border border-line bg-surface p-5 shadow-2xl shadow-black/60',
    'sm:inset-y-2 sm:right-2 sm:w-(--panel-width) sm:rounded-2xl',
    modal
      ? 'max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[88dvh] max-sm:rounded-t-2xl max-sm:pb-[max(env(safe-area-inset-bottom),1.25rem)]'
      : 'max-sm:inset-x-0 max-sm:top-0 max-sm:max-h-[55dvh] max-sm:rounded-b-2xl max-sm:pt-[max(env(safe-area-inset-top),1.25rem)]',
  ]}
  aria-label={title}
>
  <header class="flex items-center justify-between gap-2">
    <h2 class="truncate text-base font-semibold">{title}</h2>
    <div class="flex gap-1">
      {@render actions?.()}
      <Button variant="ghost" shape="square" onclick={onclose} aria-label="Close"><Icon name="close" /></Button>
    </div>
  </header>
  {@render children()}
</aside>
