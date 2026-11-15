<script lang="ts" module>
  /**
   * A mode key; `pages` names the pages that pressing it again turns through. `tabs: false` when the screen shows its
   * own; `form` when the screen already lays out every value as a field, so phones need no values row under it.
   */
  export type Mode = { id: string; label: string; pages?: string[]; tabs?: boolean; form?: boolean }

  const DRAWER_KEY = 'keyfall.keys-drawer.v1'
  function loadDrawers(): Record<string, boolean> {
    try {
      const stored = JSON.parse(localStorage.getItem(DRAWER_KEY) ?? '{}')
      return stored && typeof stored === 'object' ? stored : {}
    } catch {
      return {}
    }
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import { isTyping } from '../input/focus'
  import Icon from '../ui/Icon.svelte'
  import { layout } from '../ui/layout.svelte'
  import Segmented from '../ui/Segmented.svelte'
  import Control from './Control.svelte'
  import { KNOB_COLORS, KNOB_KEYS, knobs } from './knobs.svelte'
  import { hint, shortcuts } from './shortcuts.svelte'

  /**
   * The instrument body shared by Piano and Studio, laid out per screen shape (see ui/layout):
   *
   * - upright phone: top bar, display with its four values, the keys as a drawer, mode keys along the bottom edge;
   * - sideways phone: mode keys on a rail at the left, the values in a column at the right, keys as a drawer over
   *   the display;
   * - tablet: top bar, display, mode keys, keys;
   * - desktop: mode rail, top bar, display, keys; the knobs are drawn inside the value cells, and `inspector`
   *   (the sound beside any mode) docks at the right, toggled from the top bar or with Alt+I.
   *
   * `keysFirst` (Piano) gives phones to the keys: a slim bar keeps `quick`, and ☰ slides modes, values, `actions`
   * and `tools` down over the display. Pressing the active mode key again turns its page; pages also show as tabs.
   */
  let {
    label,
    strip,
    quick,
    tools,
    display,
    actions,
    modes,
    mode,
    page = 0,
    onmode,
    onpage,
    keys,
    inspector,
    inspectorLabel = 'Inspector',
    keysFirst = false,
    keysDefault = false,
    keysPinned = false,
  }: {
    label: string
    /** The top bar. */
    strip: Snippet
    /** Keys-first phones: what stays in the slim bar beside ☰. */
    quick?: Snippet
    /** Keys-first phones: the top bar's buttons, shown in the ☰ panel. */
    tools?: Snippet
    display: Snippet
    /** The mode's action row, under the display (in the ☰ panel on keys-first phones). */
    actions?: Snippet
    modes: Mode[]
    mode: string
    page?: number
    onmode: (mode: string) => void
    onpage?: (page: number) => void
    /** The keyboard or pads; Piano draws its own inside the display. */
    keys?: Snippet
    /** Desktop: a column docked beside the display. */
    inspector?: Snippet
    inspectorLabel?: string
    keysFirst?: boolean
    /** Phones: whether the keys drawer starts open in this mode. */
    keysDefault?: boolean
    /** Phones: keep the keys drawer open (recording). */
    keysPinned?: boolean
  } = $props()

  const active = $derived(modes.find((m) => m.id === mode))
  const pages = $derived(active?.tabs === false ? [] : (active?.pages ?? []))
  const KNOB_NAMES = ['Blue', 'Green', 'White', 'Orange']

  const kind = $derived(layout.kind)
  const focus = $derived(keysFirst && layout.phone)
  const rail = $derived(kind === 'sideways' || kind === 'desktop')
  /** Phones are short of room: a screen that is already a form of every value skips the values row. */
  const values$ = $derived(!(layout.phone && active?.form))
  const docked = $derived(!!inspector && kind === 'desktop' && layout.inspector)

  let panel = $state(false)
  $effect(() => {
    if (!focus) panel = false
  })

  // The keys drawer on phones remembers its state per mode and orientation.
  let drawers = $state(loadDrawers())
  const drawerKey = $derived(`${label}:${mode}:${kind}`)
  const drawer = $derived(!!keys && layout.phone && !focus)
  const keysOpen = $derived(!keys ? false : !drawer || keysPinned || (drawers[drawerKey] ?? keysDefault))
  function toggleKeys() {
    drawers = { ...drawers, [drawerKey]: !keysOpen }
    try {
      localStorage.setItem(DRAWER_KEY, JSON.stringify(drawers))
    } catch {}
  }

  function pick(id: string) {
    knobs.entering = null
    panel = false
    onmode(id)
  }

  $effect(() =>
    shortcuts.use(label, [
      ...modes.map((m, i) => ({
        keys: [`Alt+${i + 1}`],
        label: m.pages ? `${m.label} (again: ${m.pages.join(' / ')})` : m.label,
        run: () => pick(m.id),
      })),
      ...(inspector && kind === 'desktop' ? [{ keys: ['Alt+I'], label: `${inspectorLabel} beside the display on / off`, run: () => (layout.inspector = !layout.inspector) }] : []),
      ...KNOB_KEYS.map(([up, down], i) => ({ keys: [`Alt+${up.slice(3)}`, `Alt+${down.slice(3)}`], label: `${KNOB_NAMES[i]} knob up / down (add Shift for fine)` })),
    ]),
  )

  /** Capture phase, so shortcuts beat the note keys; text fields keep their keys. */
  function onkeydown(e: KeyboardEvent) {
    if (isTyping(e.target)) return
    if (panel && e.key === 'Escape') {
      e.preventDefault()
      panel = false
      return
    }
    if (!knobs.key(e)) shortcuts.handle(e)
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#snippet modeKeys(shape: 'row' | 'bar' | 'rail')}
  <nav class={['flex min-w-0 gap-1', shape === 'rail' ? 'flex-col' : 'flex-1']} aria-label="Modes">
    {#each modes as item, i (item.id)}
      {@const current = item.id === mode}
      {@const turns = item.pages ?? []}
      <button
        type="button"
        class={[
          'mode-key relative grid min-w-0 cursor-pointer content-center rounded-lg px-1 font-mono text-[11px] tracking-wider uppercase',
          shape === 'rail' ? 'h-14 w-full' : 'h-11 flex-1',
          shape === 'row' && 'sm:max-w-28',
          current ? 'bg-fg text-bg' : 'bg-raised text-fg hover:bg-hover',
        ]}
        aria-pressed={current}
        onclick={() => pick(item.id)}
        title={hint(turns.length > 1 ? `${item.label} · press again for ${turns[(page + 1) % turns.length]}` : item.label, `Alt+${i + 1}`)}
      >
        <span class="truncate">{item.label}</span>
        {#if current && turns.length > 1 && shape !== 'bar'}
          <span class="truncate text-[9px] tracking-normal normal-case opacity-70" aria-label="Page {page + 1} of {turns.length}: {turns[page]}">
            {#each turns as name, p (name)}{#if p}<span class="opacity-50"> · </span>{/if}<span class={p === page ? 'font-bold opacity-100' : 'opacity-50'}>{name}</span>{/each}
          </span>
        {/if}
      </button>
    {/each}
  </nav>
{/snippet}

{#snippet keysToggle(shape: 'bar' | 'rail')}
  <button
    type="button"
    class={['grid shrink-0 cursor-pointer place-items-center rounded-lg', shape === 'rail' ? 'h-14 w-full' : 'h-11 w-12', keysOpen ? 'bg-fg text-bg' : 'bg-raised text-fg']}
    aria-pressed={keysOpen}
    aria-label={keysOpen ? 'Hide keys' : 'Show keys'}
    title={keysOpen ? 'Hide keys' : 'Show keys'}
    onclick={toggleKeys}><Icon name="keyboard" /></button
  >
{/snippet}

{#snippet values(shape: 'row' | 'column')}
  <div class={['grid', shape === 'row' ? 'grid-cols-4 divide-x divide-line border-t border-line' : 'content-start divide-y divide-line']} aria-label="Knobs">
    {#each KNOB_COLORS as color, i (color)}
      <Control spec={knobs.specs[i]} color="var(--color-knob-{color})" knob={i} variant="cell" />
    {/each}
  </div>
{/snippet}

<!-- Always one element, so the display keeps its row whether the mode has pages or not. -->
{#snippet pageTabs()}
  <div class={[pages.length > 1 && onpage && 'border-b border-line p-1.5']}>
    {#if pages.length > 1 && onpage}
      <Segmented size="sm" label="{active?.label} pages" options={pages.map((name, i) => ({ value: i, label: name }))} value={page} onchange={(i) => ((knobs.entering = null), onpage(i))} />
    {/if}
  </div>
{/snippet}

{#snippet screen(withValues: boolean)}
  <section class="display grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto_auto] overflow-hidden rounded-xl bg-display" aria-label="{active?.label ?? ''} display">
    {@render pageTabs()}
    <div class="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]">{@render display()}</div>
    <div>{@render actions?.()}</div>
    {#if withValues}{@render values('row')}{/if}
  </section>
{/snippet}

{#snippet inspectorToggle()}
  {#if inspector}
    <button
      type="button"
      class={['grid size-9 shrink-0 place-items-center rounded-md', layout.inspector ? 'bg-raised text-fg' : 'text-muted hover:bg-raised']}
      aria-pressed={layout.inspector}
      aria-controls="device-inspector"
      aria-label={inspectorLabel}
      title={hint(`${inspectorLabel} beside the display`, 'Alt+I')}
      onclick={() => (layout.inspector = !layout.inspector)}><Icon name="panel-side" /></button
    >
  {/if}
{/snippet}

{#snippet keysArea(extra = '')}
  {#if keys && keysOpen}
    <div class={['keys grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl', extra]}>{@render keys()}</div>
  {/if}
{/snippet}

{#if focus}
  <!-- Phones, keys first: a slim bar, the display with the keys, and everything else behind ☰. -->
  <main class="device grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-1.5 bg-bg p-1.5 pt-[max(env(safe-area-inset-top),0.375rem)] pb-[max(env(safe-area-inset-bottom),0.375rem)] pl-[max(env(safe-area-inset-left),0.375rem)] pr-[max(env(safe-area-inset-right),0.375rem)]" aria-label={label} data-layout="{kind} keys-first">
    <header class="flex h-11 min-w-0 items-center gap-1.5" data-tauri-drag-region>
      <button
        type="button"
        class={['grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg', panel ? 'bg-fg text-bg' : 'bg-raised']}
        aria-expanded={panel}
        aria-controls="device-panel"
        aria-label={panel ? 'Hide controls' : 'Show controls'}
        onclick={() => (panel = !panel)}><Icon name={panel ? 'close' : 'settings'} /></button
      >
      {@render quick?.()}
    </header>
    <section class="display relative grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl bg-display" aria-label="{active?.label ?? ''} display">
      {@render display()}
      {#if panel}
        <div id="device-panel" class="absolute inset-x-0 top-0 z-10 grid max-h-full gap-2 overflow-y-auto overscroll-contain border-b border-line bg-surface p-2 shadow-lg shadow-black/30" role="region" aria-label="Controls">
          <div class="flex flex-wrap items-center gap-1.5">{@render (tools ?? strip)()}</div>
          {@render modeKeys('row')}
          <div class="overflow-hidden rounded-lg bg-display">{@render values('row')}</div>
          {@render actions?.()}
        </div>
      {/if}
    </section>
    {@render keysArea()}
  </main>
{:else if kind === 'upright'}
  <main class="device grid h-dvh grid-cols-[minmax(0,1fr)] gap-1.5 bg-bg p-1.5 pt-[max(env(safe-area-inset-top),0.375rem)] pb-[max(env(safe-area-inset-bottom),0.375rem)]" style:grid-template-rows="auto minmax(0,1fr) {keysOpen ? 'clamp(150px, 30dvh, 260px)' : ''} auto" aria-label={label} data-layout={kind}>
    <header class="flex min-w-0 items-center gap-1" data-tauri-drag-region>{@render strip()}</header>
    {@render screen(values$)}
    {@render keysArea()}
    <div class="flex gap-1">
      {@render modeKeys('bar')}
      {#if keys}{@render keysToggle('bar')}{/if}
    </div>
  </main>
{:else if kind === 'sideways'}
  <main class="device grid h-dvh grid-cols-[4.5rem_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-1.5 bg-bg p-1.5 pt-[max(env(safe-area-inset-top),0.375rem)] pb-[max(env(safe-area-inset-bottom),0.375rem)] pl-[max(env(safe-area-inset-left),0.375rem)] pr-[max(env(safe-area-inset-right),0.375rem)]" aria-label={label} data-layout={kind}>
    <div class="row-span-2 flex min-h-0 flex-col gap-1 overflow-y-auto [scrollbar-width:none]">
      {@render modeKeys('rail')}
      <span class="flex-1"></span>
      {#if keys}{@render keysToggle('rail')}{/if}
    </div>
    <header class="flex min-w-0 items-center gap-1" data-tauri-drag-region>{@render strip()}</header>
    <div class={['relative grid min-h-0 gap-1.5', values$ ? 'grid-cols-[minmax(0,1fr)_9.5rem]' : 'grid-cols-[minmax(0,1fr)]']}>
      {@render screen(false)}
      {#if values$}<div class="min-h-0 overflow-y-auto rounded-xl bg-display">{@render values('column')}</div>{/if}
      {@render keysArea('absolute inset-x-0 bottom-0 z-10 h-[55%] shadow-lg shadow-black/40')}
    </div>
  </main>
{:else if kind === 'desktop'}
  <main class={['device grid h-dvh gap-3 bg-bg p-3 mac-native:pt-8', docked ? 'grid-cols-[6rem_minmax(0,1fr)_22.5rem]' : 'grid-cols-[6rem_minmax(0,1fr)]']} style:grid-template-rows="auto minmax(0,1fr) {keys ? 'clamp(120px, 26dvh, 220px)' : ''}" aria-label={label} data-layout={kind}>
    <div class="row-span-2 flex min-h-0 flex-col gap-1">{@render modeKeys('rail')}</div>
    <header class={['flex min-w-0 flex-wrap items-center gap-1.5', docked && 'col-span-2']} data-tauri-drag-region>{@render strip()}{@render inspectorToggle()}</header>
    {@render screen(true)}
    {#if docked}
      <aside id="device-inspector" class="grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl bg-display" aria-label={inspectorLabel}>{@render inspector?.()}</aside>
    {/if}
    {@render keysArea(docked ? 'col-span-3' : 'col-span-2')}
  </main>
{:else}
  <main class="device grid h-dvh grid-cols-[minmax(0,1fr)] gap-2 bg-bg p-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:gap-3 sm:p-3 mac-native:pt-8" style:grid-template-rows="auto minmax(0,1fr) auto {keys ? 'clamp(110px, 24dvh, 190px)' : ''}" aria-label={label} data-layout={kind}>
    <header class="flex min-w-0 flex-wrap items-center gap-1.5" data-tauri-drag-region>{@render strip()}</header>
    {@render screen(true)}
    <div class="flex">{@render modeKeys('row')}</div>
    {@render keysArea()}
  </main>
{/if}
