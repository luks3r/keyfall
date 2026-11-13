<script lang="ts" module>
  /** A mode key; `pages` names the pages that pressing it again turns through. */
  export type Mode = { id: string; label: string; pages?: string[] }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import { isTyping } from '../input/focus'
  import { focusOnMount } from '../ui/focus'
  import Knob from './Knob.svelte'
  import { KNOB_COLORS, KNOB_KEYS, knobs } from './knobs.svelte'
  import { hint, shortcuts } from './shortcuts.svelte'

  /**
   * The instrument body shared by Piano and Studio: a fixed strip on top, one display, mode keys and four knobs
   * under it, and the keyboard (or pads) at the bottom. Pressing the active mode key again turns its page.
   */
  let {
    label,
    strip,
    display,
    modes,
    mode,
    page = 0,
    onmode,
    keys,
  }: {
    label: string
    strip: Snippet
    display: Snippet
    modes: Mode[]
    mode: string
    page?: number
    onmode: (mode: string) => void
    keys?: Snippet
  } = $props()

  const active = $derived(modes.find((m) => m.id === mode))
  const KNOB_NAMES = ['Blue', 'Green', 'White', 'Orange']

  $effect(() =>
    shortcuts.use(label, [
      ...modes.map((m, i) => ({
        keys: [`Alt+${i + 1}`],
        label: m.pages ? `${m.label} (again: ${m.pages.join(' / ')})` : m.label,
        run: () => onmode(m.id),
      })),
      ...KNOB_KEYS.map(([up, down], i) => ({ keys: [`Alt+${up.slice(3)}`, `Alt+${down.slice(3)}`], label: `${KNOB_NAMES[i]} knob up / down (add Shift for fine)` })),
    ]),
  )

  /** Capture phase, so shortcuts beat the note keys; text fields keep their keys. */
  function onkeydown(e: KeyboardEvent) {
    if (isTyping(e.target)) return
    if (!knobs.key(e)) shortcuts.handle(e)
  }

  function commit(index: number, input: HTMLInputElement) {
    if (knobs.entering !== index) return
    knobs.enter(index, input.value)
    knobs.entering = null
  }
</script>

<svelte:window onkeydowncapture={onkeydown} />

<main class="device grid h-dvh grid-cols-[minmax(0,1fr)] gap-2 bg-bg p-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:gap-3 sm:p-3 mac-native:pt-8" class:has-keys={!!keys} aria-label={label}>
  <header class="flex min-w-0 flex-wrap items-center gap-1.5" data-tauri-drag-region>
    {@render strip()}
  </header>

  <section class="display grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-xl bg-display" aria-label="{active?.label ?? ''} display">
    <div class="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)]">{@render display()}</div>
    <div class="grid grid-cols-4 border-t border-line" aria-label="Knobs">
      {#each KNOB_COLORS as color, i (color)}
        {@const spec = knobs.specs[i]}
        <div class="min-w-0 px-2 py-1.5" style:box-shadow="inset 0 3px 0 var(--color-knob-{color})">
          <div class="truncate font-mono text-[10px] tracking-wider text-muted uppercase">{spec?.label ?? '—'}</div>
          {#if spec && knobs.entering === i}
            <input
              class="w-full min-w-0 bg-transparent font-mono text-sm tabular-nums outline-none [box-shadow:inset_0_-1px_0_var(--color-fg)]"
              value={knobs.draft ?? spec.display()}
              aria-label="{spec.label} value"
              use:focusOnMount={knobs.draft === null}
              onkeydown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commit(i, e.currentTarget)
                else if (e.key === 'Escape') knobs.entering = null
              }}
              onblur={(e) => commit(i, e.currentTarget)}
            />
          {:else if spec}
            <button
              type="button"
              class="block w-full cursor-text truncate text-left font-mono text-sm tabular-nums"
              onclick={() => knobs.type(i)}
              title="Type a value">{spec.display()}</button
            >
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <div class="controls flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
    <nav class="flex min-w-0 flex-1 gap-1" aria-label="Modes">
      {#each modes as item, i (item.id)}
        {@const current = item.id === mode}
        {@const pages = item.pages ?? []}
        <button
          type="button"
          class={['mode-key relative grid h-11 min-w-0 flex-1 cursor-pointer content-center rounded-lg font-mono text-[11px] tracking-wider uppercase sm:max-w-28', current ? 'bg-fg text-bg' : 'bg-raised text-fg hover:bg-hover']}
          aria-pressed={current}
          onclick={() => onmode(item.id)}
          title={hint(pages.length > 1 ? `${item.label} · press again for ${pages[(page + 1) % pages.length]}` : item.label, `Alt+${i + 1}`)}
        >
          <span class="truncate">{item.label}</span>
          {#if current && pages.length > 1}
            <span class="truncate text-[9px] tracking-normal normal-case opacity-70" aria-label="Page {page + 1} of {pages.length}: {pages[page]}">
              {#each pages as name, p (name)}{#if p}<span class="opacity-50"> · </span>{/if}<span class={p === page ? 'font-bold opacity-100' : 'opacity-50'}>{name}</span>{/each}
            </span>
          {/if}
        </button>
      {/each}
    </nav>
    <div class="flex shrink-0 gap-3 max-sm:w-full max-sm:justify-around">
      {#each KNOB_COLORS as color, i (color)}<Knob index={i} {color} />{/each}
    </div>
  </div>

  {#if keys}
    <div class="keys grid min-h-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl">{@render keys()}</div>
  {/if}
</main>

<style>
  .device {
    grid-template-rows: auto minmax(0, 1fr) auto;
  }
  .device.has-keys {
    grid-template-rows: auto minmax(0, 1fr) auto clamp(110px, 24dvh, 190px);
  }
</style>
