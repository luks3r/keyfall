<script lang="ts">
  import type { Snippet } from 'svelte'
  import { controls } from '../studio/controls.svelte'
  import { dragSpec, wheelTurner } from './drag'
  import { valueKeys } from './keys'
  import { KNOB_KEYS, knobs, reset, type KnobSpec } from './knobs.svelte'
  import ValuePopover from './ValuePopover.svelte'

  /**
   * A value you can grab anywhere: drag right or up to raise it (Shift for fine), scroll, or tap to open it (a list
   * for choices; slider, − / + and a text field for numbers). Double-click resets. `knob` ties it to a device knob,
   * whose value it shows on the display; `extra` adds to the opened view.
   *
   * `cell` is one of the device's four values (with its knob drawn in for mouse users), `field` a row in an editor
   * (vertical swipes scroll the page), `chip` a compact readout for the top strip.
   */
  let {
    spec,
    color = 'var(--color-fg)',
    knob,
    variant = 'field',
    extra,
  }: { spec: KnobSpec | null; color?: string; knob?: number; variant?: 'cell' | 'field' | 'chip'; extra?: Snippet } = $props()

  /** Pixels of drag for the whole range: one and a half widths of the control, within these bounds. */
  const RANGE = { min: 160, max: 360 }
  const wheel = wheelTurner()

  let element = $state<HTMLDivElement>()
  let localOpen = $state(false)
  let localDraft = $state<string | null>(null)

  const open = $derived(knob === undefined ? localOpen : knobs.entering === knob)
  const draft = $derived(knob === undefined ? localDraft : knobs.draft)
  const value = $derived(spec?.value() ?? 0)
  const learning = $derived(knob !== undefined && controls.learnKnob === knob)

  function show(text: string | null = null) {
    if (knob !== undefined) return knobs.type(knob, text)
    localDraft = text
    localOpen = true
  }

  function close() {
    if (knob !== undefined) {
      if (knobs.entering === knob) knobs.entering = null
    } else localOpen = false
  }

  function down(e: PointerEvent) {
    if (!spec || e.button !== 0) return
    if (e.altKey || e.metaKey || e.ctrlKey) return reset(spec)
    const wasOpen = open
    const range = Math.min(RANGE.max, Math.max(RANGE.min, (element?.offsetWidth ?? 0) * 1.5))
    // A finger swiping up and down a field scrolls the page; a mouse can drag either way.
    const axis = variant === 'field' && e.pointerType === 'touch' ? 'x' : 'both'
    dragSpec(e, spec, { range, axis, tap: () => (wasOpen ? close() : show()) })
  }
</script>

<div
  bind:this={element}
  class={[
    'control relative min-w-0 cursor-ew-resize overflow-hidden outline-offset-[-2px]',
    variant === 'field' ? 'touch-pan-y' : 'touch-none',
    variant === 'cell' && 'min-h-12 px-2 pt-2 pb-1.5 pointer-coarse:min-h-14',
    variant === 'field' && 'grid h-14 content-center rounded-md bg-raised px-3',
    variant === 'chip' && 'flex h-9 items-center gap-1.5 rounded-md bg-raised px-2.5',
    !spec && 'pointer-events-none opacity-40',
    learning && 'animate-pulse',
    open && 'bg-hover',
  ]}
  style:--tint={color}
  role="slider"
  tabindex={spec ? 0 : -1}
  aria-label={spec?.label ?? 'Unused'}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(value * 100)}
  aria-valuetext={spec?.display()}
  title={spec ? `${spec.label} · drag or scroll · tap to open · double-click to reset${knob === undefined ? '' : ` · Alt+${KNOB_KEYS[knob].map((code) => code.slice(3)).join('/')}`}` : undefined}
  onpointerdown={down}
  ondblclick={() => spec && (close(), reset(spec))}
  oncontextmenu={(e) => (e.preventDefault(), spec && show())}
  onwheel={(e) => spec && wheel(e, spec)}
  onkeydown={(e) => spec && valueKeys(e, spec, show)}
>
  {#if variant === 'field'}
    <div class="absolute inset-y-0 left-0 bg-[color-mix(in_srgb,var(--tint)_22%,transparent)]" style:width="{value * 100}%" aria-hidden="true"></div>
    <span class="relative truncate font-mono text-[10px] tracking-wider text-muted uppercase">{spec?.label ?? '—'}</span>
    <span class="relative truncate font-mono text-base tabular-nums">{spec?.display() ?? ''}</span>
  {:else if variant === 'chip'}
    <!-- Phones upright are short of width: the chip keeps its value, the name moves to the tooltip. -->
    <span class="label text-muted max-sm:sr-only">{spec?.label}</span>
    <span class="font-mono text-sm tabular-nums">{spec?.display()}</span>
    <div class="absolute inset-x-0 bottom-0 h-0.5 bg-(--tint)" style:width="{value * 100}%" aria-hidden="true"></div>
  {:else}
    <div class="absolute inset-x-0 top-0 h-[3px] bg-(--tint)" aria-hidden="true"></div>
    <div class="flex min-w-0 items-center gap-2">
      <!-- The device knob itself, drawn in for mouse users; fingers use the bar below. -->
      {#if knob !== undefined}
        <svg viewBox="0 0 44 44" class={['size-9 shrink-0 pointer-coarse:hidden', !spec && 'opacity-30']} aria-hidden="true">
          <circle cx="22" cy="22" r="19" fill="var(--tint)" />
          <circle cx="22" cy="22" r="13" fill="var(--color-knob-cap)" />
          <line x1="22" y1="22" x2="22" y2="11" stroke="var(--color-knob-mark)" stroke-linecap="round" stroke-width="3" transform="rotate({-135 + value * 270} 22 22)" />
        </svg>
      {/if}
      <div class="min-w-0 flex-1">
        <div class="label truncate text-muted">{spec?.label ?? '—'}</div>
        <div class="truncate font-mono text-sm tabular-nums">{spec?.display() ?? ''}</div>
        {#if spec}
          <div class={['mt-1 h-1 rounded-full bg-line', knob !== undefined && 'pointer-fine:hidden']} aria-hidden="true"><div class="h-full rounded-full bg-(--tint)" style:width="{value * 100}%"></div></div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if open && spec && element}
  <ValuePopover {spec} anchor={element} {knob} {draft} {extra} onclose={close} />
{/if}
