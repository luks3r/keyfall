<script lang="ts">
  import { onMount, type Snippet } from 'svelte'
  import { MediaQuery } from 'svelte/reactivity'
  import { fly } from 'svelte/transition'
  import Button from './Button.svelte'
  import Icon from './Icon.svelte'
  import { cycleTab, holdFocus } from './overlay'
  import { SHEET_QUERY } from './Popover.svelte'
  import { viewport } from './viewport.svelte'

  /**
   * A side panel on wide screens; on a phone a sheet. A modal panel comes up from the bottom (in thumb reach, above
   * the on-screen keyboard) and holds focus; a non-modal one drops from the top so the keys below stay playable.
   */
  let {
    title,
    modal = true,
    width = 320,
    actions,
    children,
    onclose,
  }: { title: string; modal?: boolean; width?: number; actions?: Snippet; children: Snippet; onclose: () => void } = $props()

  let panel: HTMLElement
  const phone = new MediaQuery(SHEET_QUERY)

  onMount(() => {
    const stopViewport = viewport.use()
    if (!modal) return stopViewport
    const release = holdFocus(panel)
    return () => {
      release()
      stopViewport()
    }
  })

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      return onclose()
    }
    if (modal) cycleTab(e, panel)
  }
</script>

{#if modal}
  <!-- Closes on click, not press, so the lifting finger does not land on what lies under the backdrop. -->
  <div class="fixed inset-0 z-10 bg-black/30" onclick={onclose} aria-hidden="true"></div>
{/if}
<aside
  bind:this={panel}
  role={modal ? 'dialog' : 'complementary'}
  aria-modal={modal ? true : undefined}
  tabindex="-1"
  data-input-scope={modal ? 'ui' : undefined}
  onkeydown={onKey}
  transition:fly={phone.current ? { y: modal ? 48 : -48, duration: 200 } : { x: 24, duration: 160 }}
  style:--panel-width="min({width}px, calc(100vw - 16px))"
  style:bottom={phone.current && modal ? `${viewport.keyboard}px` : undefined}
  style:max-height={phone.current ? `${Math.round(viewport.height * (modal ? 0.88 : 0.55))}px` : undefined}
  class={[
    'fixed z-20 flex flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain border border-line bg-surface p-5 outline-none',
    'sm:inset-y-2 sm:right-2 sm:w-(--panel-width) sm:rounded-control',
    modal
      ? 'max-sm:inset-x-0 max-sm:rounded-t-surface max-sm:pb-[max(env(safe-area-inset-bottom),1.25rem)]'
      : 'max-sm:inset-x-0 max-sm:top-0 max-sm:rounded-b-surface max-sm:pt-[max(env(safe-area-inset-top),1.25rem)]',
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
