<script lang="ts">
  import { onMount } from 'svelte'
  import { MediaQuery } from 'svelte/reactivity'
  import Control from '../device/Control.svelte'
  import { choiceKnob, rangeKnob } from '../device/knob-specs'
  import { settings } from '../settings.svelte'
  import type { ThemePreference } from '../theme'
  import Button, { VARIANTS, type ButtonVariant } from './Button.svelte'
  import Field from './Field.svelte'
  import { hold } from './hold'
  import Icon from './Icon.svelte'
  import Menu from './Menu.svelte'
  import MenuItem from './MenuItem.svelte'
  import Panel from './Panel.svelte'
  import Popover from './Popover.svelte'
  import Section from './Section.svelte'
  import Segmented from './Segmented.svelte'
  import Select from './Select.svelte'
  import Toggle from './Toggle.svelte'
  import Toolbar from './Toolbar.svelte'
  import { viewport } from './viewport.svelte'

  /**
   * Every library part in every state, at #ui. The reference for how things look, and what the UI check photographs
   * on phone and desktop sizes in both themes.
   */

  const coarse = new MediaQuery('pointer: coarse')
  onMount(() => viewport.use())

  const THEMES: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]
  const SWATCHES = ['bg', 'surface', 'raised', 'hover', 'line', 'fg', 'muted', 'mint', 'danger', 'display', 'knob-blue', 'knob-green', 'knob-white', 'knob-orange']
  const TYPE = [
    { name: 'label', class: 'label' },
    { name: 'xs · 12', class: 'text-xs' },
    { name: 'sm · 14', class: 'text-sm' },
    { name: 'base · 16', class: 'text-base' },
    { name: 'lg · 18', class: 'text-lg' },
  ]

  let level = $state(0.7)
  let wave = $state('sine')
  let mode = $state('steps')
  let enabled = $state(true)
  let preset = $state('pop')
  let name = $state('')
  let pressed = $state(false)
  const levelSpec = rangeKnob('Level', 0, 1, () => level, (v) => (level = v), (v) => `${Math.round(v * 100)}%`, { initial: 0.7 })
  const waveSpec = choiceKnob('Wave', ['sine', 'triangle', 'square', 'saw'], () => wave, (v) => (wave = v), String, 'sine')

  let log = $state<string[]>([])
  const did = (what: string) => (log = [what, ...log].slice(0, 4))
  const ACTIONS = ['Copy', 'Paste', 'Clear', 'Nudge ◀', 'Nudge ▶', 'Rotate', 'Double', 'Quantize']
  const items = $derived([
    ...ACTIONS.map((label) => ({ label, onclick: () => did(label) })),
    { label: 'Record', active: pressed, onclick: () => (pressed = !pressed) },
  ])

  let menu = $state<{ anchor?: HTMLElement; point?: { x: number; y: number }; label: string } | null>(null)
  let popover = $state<HTMLElement | null>(null)
  let panel = $state<'modal' | 'side' | null>(null)

  const openFrom = (e: MouseEvent, label: string) => (menu = { anchor: e.currentTarget as HTMLElement, label })
</script>

{#snippet menuRows()}
  <MenuItem onclick={() => did('Duplicate')}>Duplicate</MenuItem>
  <MenuItem onclick={() => did('Rename')}>Rename…</MenuItem>
  <MenuItem checked={pressed} onclick={() => (pressed = !pressed)}>Armed</MenuItem>
  <MenuItem disabled onclick={() => {}}>Unavailable</MenuItem>
  <MenuItem destructive onclick={() => did('Delete')}>Delete</MenuItem>
{/snippet}

<main class="h-dvh overflow-y-auto bg-bg px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),2rem)] select-text" aria-label="UI library">
  <div class="mx-auto grid max-w-3xl gap-8">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold">Keyfall UI</h1>
        <p class="label text-muted" data-testid="environment">{coarse.current ? 'touch' : 'mouse'} · {innerWidth}×{Math.round(viewport.height)}</p>
      </div>
      <Segmented label="Theme" options={THEMES} bind:value={settings.theme} />
    </header>

    <Section title="Colour">
      <div class="grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))] gap-2">
        {#each SWATCHES as swatch (swatch)}
          <div class="grid gap-1">
            <div class="h-10 rounded-control border border-line" style:background="var(--color-{swatch})"></div>
            <span class="label truncate text-muted">{swatch}</span>
          </div>
        {/each}
      </div>
    </Section>

    <Section title="Type">
      <div class="grid gap-2">
        {#each TYPE as type (type.name)}<p class={type.class}>{type.name} · The quick brown fox</p>{/each}
      </div>
    </Section>

    <Section title="Buttons">
      <div class="grid gap-3">
        {#each ['md', 'sm'] as const as size (size)}
          <div class="flex flex-wrap items-center gap-2">
            {#each Object.keys(VARIANTS) as ButtonVariant[] as variant (variant)}
              <Button {variant} {size} onclick={() => did(variant)}>{variant}</Button>
            {/each}
            <Button {size} caps>caps</Button>
            <Button {size} disabled>disabled</Button>
            <Button {size} shape="square" aria-label="Undo"><Icon name="undo" /></Button>
            <Button {size} shape="round" variant="accent" aria-label="Play"><Icon name="play" filled /></Button>
            <Button {size} aria-pressed={pressed} onclick={() => (pressed = !pressed)}>pressed</Button>
          </div>
        {/each}
      </div>
    </Section>

    <Section title="Choices">
      <div class="grid gap-3 sm:grid-cols-2">
        <Field label="Segmented"><Segmented label="Edit mode" options={[{ value: 'steps', label: 'Steps' }, { value: 'notes', label: 'Notes' }, { value: 'pads', label: 'Pads' }]} bind:value={mode} /></Field>
        <Field label="Select" hint={preset}>
          <Select bind:value={preset} options={[{ value: 'pop', label: 'Pop Synth', group: 'Synth' }, { value: 'pad', label: 'Warm Pad', group: 'Synth' }, { value: 'grand', label: 'Grand Piano', group: 'Keys' }]} />
        </Field>
        <Toggle label="Metronome" bind:checked={enabled} />
        <Field label="Text field">
          <input bind:value={name} placeholder="Sound name" class="h-control rounded-control bg-raised px-2.5 outline-none focus:ring-1 focus:ring-fg" data-ui />
        </Field>
      </div>
    </Section>

    <Section title="Values">
      <p class="text-xs text-muted">Drag sideways (or up), scroll, tap to open, {coarse.current ? 'Reset inside' : 'double-click to reset'}.</p>
      <div class="grid grid-cols-2 gap-2">
        <Control spec={levelSpec} color="var(--color-knob-blue)" />
        <Control spec={waveSpec} color="var(--color-knob-green)" />
      </div>
      <div class="flex flex-wrap gap-2">
        <Control spec={levelSpec} variant="chip" />
        <Control spec={waveSpec} variant="chip" />
      </div>
    </Section>

    <Section title="Toolbar">
      <p class="text-xs text-muted">Keys that do not fit move into More. Drag the corner to resize.</p>
      <div class="w-full min-w-40 resize-x overflow-hidden rounded-control bg-display" data-testid="toolbar-box"><Toolbar {items} label="Gallery actions" /></div>
      <p class="label text-muted" aria-live="polite">{log.join(' · ') || '—'}</p>
    </Section>

    <Section title="Menus and popovers">
      <p class="text-xs text-muted">Menus stay on screen at every edge; on a phone they open as a sheet.</p>
      <div class="relative h-48 rounded-control border border-dashed border-line" data-testid="menu-box">
        <Button class="absolute top-2 left-2" onclick={(e) => openFrom(e, 'Top left')}>Top left</Button>
        <Button class="absolute top-2 right-2" onclick={(e) => openFrom(e, 'Top right')}>Top right</Button>
        <Button class="absolute bottom-2 left-2" onclick={(e) => openFrom(e, 'Bottom left')}>Bottom left</Button>
        <Button class="absolute right-2 bottom-2" onclick={(e) => openFrom(e, 'Bottom right')}>Bottom right</Button>
        <div
          class="absolute inset-x-20 top-1/2 grid h-14 -translate-y-1/2 place-items-center rounded-control bg-raised text-xs text-muted touch-pan-y"
          use:hold={(point) => (menu = { point, label: 'Context' })}
          role="button"
          tabindex="0"
          data-testid="hold-target"
        >
          {coarse.current ? 'Hold' : 'Right-click'} for a menu
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button onclick={(e) => (popover = popover ? null : (e.currentTarget as HTMLElement))} aria-expanded={!!popover}>Popover with a field</Button>
        <Button onclick={() => (panel = 'modal')}>Modal panel</Button>
        <Button onclick={() => (panel = panel === 'side' ? null : 'side')}>Side panel</Button>
      </div>
    </Section>
  </div>
</main>

{#if menu}
  <Menu anchor={menu.anchor} point={menu.point} label={menu.label} onclose={() => (menu = null)}>{@render menuRows()}</Menu>
{/if}

{#if popover}
  <Popover anchor={popover} label="Rename" onclose={() => (popover = null)}>
    <div class="grid gap-2 p-1.5">
      <input bind:value={name} placeholder="Sound name" aria-label="Sound name" class="h-control rounded-control bg-raised px-2.5 outline-none focus:ring-1 focus:ring-fg" data-ui />
      <div class="flex justify-end gap-2">
        <Button variant="ghost" onclick={() => (popover = null)}>Cancel</Button>
        <Button variant="accent" onclick={() => (did(`Renamed ${name}`), (popover = null))}>Save</Button>
      </div>
    </div>
  </Popover>
{/if}

{#if panel}
  <Panel title={panel === 'modal' ? 'Modal panel' : 'Side panel'} modal={panel === 'modal'} onclose={() => (panel = null)}>
    <p class="text-sm text-muted">{panel === 'modal' ? 'Holds focus. On a phone it rises from the bottom and stays above the keyboard.' : 'Leaves the page usable. On a phone it drops from the top.'}</p>
    <Field label="Name"><input bind:value={name} class="h-control rounded-control bg-raised px-2.5" data-ui /></Field>
  </Panel>
{/if}
