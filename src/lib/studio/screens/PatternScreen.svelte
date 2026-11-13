<script lang="ts">
  import { choiceKnob, knobs, percentKnob, rangeKnob, type KnobSpec } from '../../device/knobs.svelte'
  import { shortcuts } from '../../device/shortcuts.svelte'
  import SoftKeys, { type SoftKey } from '../../device/SoftKeys.svelte'
  import { noteName } from '../../input/keymaps'
  import Menu from '../../ui/Menu.svelte'
  import { MAX_BARS, patternView, RESOLUTION_NAMES, RESOLUTIONS } from '../pattern.svelte'
  import PianoRoll, { ZOOMS } from '../PianoRoll.svelte'
  import { QUANTIZE_GRIDS, type Clip, type Track } from '../project'
  import StepSequencer from '../StepSequencer.svelte'
  import { isKit, studio, trackChannel } from '../studio.svelte'

  /**
   * One track's patterns (its session slots) or the song clip picked on the Song screen: pick one on top, edit it
   * as steps (page 1) or notes (page 2).
   */
  let { track, color, page }: { track: Track; color: string; page: number } = $props()

  const GRID_NAMES = new Map<number, string>([
    [0, 'off'],
    [1, '1/4'],
    [0.5, '1/8'],
    [0.25, '1/16'],
    [1 / 3, '1/8T'],
    [0.125, '1/32'],
  ])
  const SNAPS = [1, 0.5, 0.25, 1 / 3, 0.125]
  const OCTAVES = Array.from({ length: 9 }, (_, i) => i * 12)
  const DEFAULT_OCTAVE = 48
  const DEFAULT_SNAP = 0.25
  const DEFAULT_ZOOM = 3
  const DEFAULT_STEP = 1 / 4

  let grid = $state(DEFAULT_SNAP)
  let zoomIndex = $state(DEFAULT_ZOOM)
  let menu = $state<{ scene: number; x: number; y: number } | null>(null)

  const scene = $derived(studio.selectedScene)
  /** A song clip of this track selected on the Song screen takes precedence over the pattern slots. */
  const songClip = $derived(studio.clip && track.clips.includes(studio.clip) ? studio.clip : null)
  const clip = $derived(songClip ?? track.slots[scene] ?? null)
  const bar = $derived(studio.project.beatsPerBar)
  const lane = $derived(studio.laneOf(track))
  const stepping = $derived(!!clip && studio.stepInput?.clip === clip.id)
  const playing = $derived(!!clip && lane?.active === clip.id)
  const menuSlot = $derived(menu ? track.slots[menu.scene] : null)

  /** Clicking the lit empty pattern (or double-clicking any empty one) starts it. */
  function pick(index: number) {
    if (index === scene && !songClip && !track.slots[index]) studio.addSlotClip(track, index)
    else studio.selectSlot(track.id, index)
  }

  const launch = () => clip && !songClip && studio.launch(track, playing ? null : clip)

  const specs = $derived.by((): (KnobSpec | null)[] => {
    // Knob closures outlive the clip (undo, delete), so they hold on to this one rather than the derived value.
    const current = clip
    if (!current) return [null, null, null, null]
    const length = rangeKnob('Length', 1, MAX_BARS, () => current.length / bar, (v) => patternView.setBars(current, v), (v) => `${Math.round(v)} bar${Math.round(v) === 1 ? '' : 's'}`, { initial: studio.project.loopBars, step: 1 })
    if (page === 0) {
      return [
        choiceKnob('Step size', RESOLUTIONS, () => patternView.resolution as (typeof RESOLUTIONS)[number], (v) => (patternView.resolution = v), (v) => RESOLUTION_NAMES.get(v) ?? '', DEFAULT_STEP),
        length,
        isKit(track) ? null : choiceKnob('Octave', OCTAVES, () => OCTAVES.reduce((a, b) => (Math.abs(b - patternView.base) < Math.abs(a - patternView.base) ? b : a)), (v) => (patternView.base = v), (v) => noteName(v), DEFAULT_OCTAVE),
        percentKnob('Velocity', () => patternView.velocity, (v) => (patternView.velocity = v), 1, 0.1),
      ]
    }
    return [
      choiceKnob('Snap', SNAPS, () => grid, (v) => (grid = v), (v) => GRID_NAMES.get(v) ?? '', DEFAULT_SNAP),
      choiceKnob('Quantize', QUANTIZE_GRIDS, () => current.quantize as (typeof QUANTIZE_GRIDS)[number], (v) => studio.tweak(() => (current.quantize = v)), (v) => GRID_NAMES.get(v) ?? '', 0),
      choiceKnob('Zoom', ZOOMS.map((_, i) => i), () => zoomIndex, (v) => (zoomIndex = v), (v) => `${v + 1}×`, DEFAULT_ZOOM),
      length,
    ]
  })

  $effect(() => knobs.use(specs))

  /** A different clip starts with nothing selected and pastes at its start. */
  $effect(() => {
    void clip?.id
    patternView.select([])
    patternView.insert = 0
  })

  const selection = $derived(clip ? patternView.selection(clip) : [])
  /** Step for copy, move and duplicate: the step size on the step grid, the snap on the note grid. */
  const step = () => (page === 0 ? patternView.resolution : grid)
  const editing = () => !!document.activeElement?.closest('[data-pattern-editor]')

  $effect(() => {
    const target: Clip | null = clip
    if (!target) return
    const selected = () => patternView.selection(target).length > 0
    return shortcuts.use('Pattern', [
      { keys: ['Shift+Enter'], label: 'Step input on / off', run: () => patternView.toggleStepInput(target) },
      { keys: ['Mod+Enter'], label: 'Launch / stop this pattern', run: launch, when: () => !songClip },
      { keys: ['Mod+A'], label: 'Select all notes', run: () => patternView.select(target.notes) },
      { keys: ['Mod+C'], label: 'Copy selected notes', run: () => patternView.copy(target, step()), when: selected },
      { keys: ['Mod+X'], label: 'Cut selected notes', run: () => patternView.cut(target, step()), when: selected },
      { keys: ['Mod+V'], label: 'Paste at the dashed line (click to move it)', run: () => patternView.paste(target), when: () => !!patternView.clipboard },
      { keys: ['Mod+D'], label: 'Duplicate selected notes (nothing selected: double the pattern)', run: () => (selected() ? patternView.duplicate(target, step()) : patternView.double(target)) },
      { keys: ['Delete', 'Backspace'], label: 'Delete selected notes', run: () => patternView.remove(target), when: () => selected() && !studio.stepInput },
      { keys: ['Escape'], label: 'Select nothing', run: () => patternView.select([]), when: selected },
      { keys: ['←', '→'], label: 'Move selected notes a step', run: (e) => patternView.move(target, e.code === 'ArrowRight' ? step() : -step(), 0), when: () => selected() && editing() },
      { keys: ['↑', '↓'], label: 'Move selected notes a semitone', run: (e) => patternView.move(target, 0, e.code === 'ArrowUp' ? 1 : -1), when: () => selected() && editing() },
      { keys: ['Shift+↑', 'Shift+↓'], label: 'Move selected notes an octave', run: (e) => patternView.move(target, 0, e.code === 'ArrowUp' ? 12 : -12), when: () => selected() && editing() },
      { keys: ['Alt+←', 'Alt+→'], label: 'Nudge selected notes (or all) a step, wrapping', run: (e) => patternView.rotate(target, e.code === 'ArrowRight' ? 1 : -1) },
      { keys: ['Mod+Backspace'], label: 'Clear all notes', run: () => patternView.clear(target) },
      ...(page === 0
        ? [
            { keys: ['←', '→', '↑', '↓'], label: 'Step grid: move the cursor' },
            { keys: ['Enter'], label: 'Step grid: add / remove the step' },
            { keys: ['Shift+←', 'Shift+→'], label: 'Step grid: shorter / longer' },
            { keys: ['Shift+↑', 'Shift+↓'], label: 'Step grid: louder / softer' },
          ]
        : []),
    ])
  })

  /** One row of keys: what the selection can do while notes are selected, the pattern's own actions otherwise. */
  const SOFT_KEYS = $derived.by((): SoftKey[] => {
    if (!clip) return []
    const target = clip
    const transport: SoftKey[] = [
      ...(songClip ? [] : [{ label: playing ? 'Stop' : 'Launch', onclick: launch, active: playing, shortcut: 'Mod+Enter' }]),
      { label: 'Step input', onclick: () => patternView.toggleStepInput(target), active: stepping, title: 'Notes you play fill steps one by one', shortcut: 'Shift+Enter' },
      ...(stepping
        ? [
            { label: 'Back', onclick: () => studio.stepMove(-1), shortcut: '←' },
            { label: 'Rest', onclick: () => studio.stepMove(1), shortcut: '→' },
          ]
        : []),
    ]
    const paste: SoftKey[] = patternView.clipboard ? [{ label: 'Paste', onclick: () => patternView.paste(target), title: 'Paste at the dashed line', shortcut: 'Mod+V' }] : []
    if (selection.length) {
      return [
        ...transport,
        { label: 'Copy', onclick: () => patternView.copy(target, step()), shortcut: 'Mod+C' },
        { label: 'Cut', onclick: () => patternView.cut(target, step()), shortcut: 'Mod+X' },
        ...paste,
        { label: 'Duplicate', onclick: () => patternView.duplicate(target, step()), title: 'Copy right after itself', shortcut: 'Mod+D' },
        { label: '◀', onclick: () => patternView.rotate(target, -1), title: 'Nudge selected notes left', shortcut: 'Alt+←' },
        { label: '▶', onclick: () => patternView.rotate(target, 1), title: 'Nudge selected notes right', shortcut: 'Alt+→' },
        { label: `Delete ${selection.length}`, onclick: () => patternView.remove(target), title: 'Delete selected notes', shortcut: 'Delete' },
        { label: 'Select none', onclick: () => patternView.select([]), shortcut: 'Escape' },
      ]
    }
    return [
      ...transport,
      ...paste,
      { label: 'Select all', onclick: () => patternView.select(target.notes), disabled: !target.notes.length, shortcut: 'Mod+A' },
      { label: '◀', onclick: () => patternView.rotate(target, -1), title: 'Nudge left', shortcut: 'Alt+←' },
      { label: '▶', onclick: () => patternView.rotate(target, 1), title: 'Nudge right', shortcut: 'Alt+→' },
      { label: 'Double', onclick: () => patternView.double(target), title: 'Twice as long, notes copied', shortcut: 'Mod+D' },
      { label: 'Clear', onclick: () => patternView.clear(target), disabled: !target.notes.length, title: 'Clear all notes', shortcut: 'Mod+Backspace' },
    ]
  })
</script>

<div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
  <div class="flex gap-1 overflow-x-auto px-2 pt-2 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Patterns of {track.name}">
    {#if songClip}
      <button type="button" role="tab" aria-selected="true" class="h-9 shrink-0 rounded-md bg-fg px-3 font-mono text-xs text-bg" title="The clip picked on the Song screen">Song · bar {Math.floor(songClip.start / bar) + 1}</button>
    {/if}
    {#each track.slots as slot, i (i)}
      {@const live = !!slot && lane?.active === slot.id}
      {@const selected = !songClip && i === scene}
      <button
        type="button"
        role="tab"
        aria-selected={selected}
        class={['relative h-9 min-w-10 flex-1 cursor-pointer rounded-md font-mono text-xs', selected ? 'bg-fg text-bg' : slot ? 'bg-raised' : 'border border-dashed border-line text-muted']}
        onclick={() => pick(i)}
        ondblclick={() => !slot && studio.addSlotClip(track, i)}
        oncontextmenu={(e) => (e.preventDefault(), studio.selectSlot(track.id, i), (menu = { scene: i, x: e.clientX, y: e.clientY }))}
        title={slot ? `Pattern ${i + 1} · right-click for more` : selected ? 'Click again to start a pattern' : `Pattern ${i + 1} (empty) · double-click to start`}
      >
        {i + 1}
        {#if slot}<span class="absolute top-1 right-1 size-1.5 rounded-full" style:background={live ? 'var(--color-danger)' : color}></span>{/if}
      </button>
    {/each}
  </div>

  {#if clip}
    {#if page === 0}
      <StepSequencer {track} {clip} {color} />
    {:else}
      <PianoRoll {track} {clip} channel={trackChannel(studio.project.tracks.indexOf(track))} {color} bind:grid bind:zoomIndex />
    {/if}
    <SoftKeys keys={SOFT_KEYS} />
  {:else}
    <button type="button" class="m-3 grid cursor-pointer place-items-center rounded-lg border border-dashed border-line text-muted" onclick={() => studio.addSlotClip(track, scene)}>
      Pattern {scene + 1} is empty · click to start one
    </button>
    <div></div>
  {/if}
</div>

{#if menu}
  <Menu point={menu} onclose={() => (menu = null)}>
    {#if menuSlot}
      {@const slot = menuSlot}
      <button type="button" role="menuitem" onclick={() => studio.launch(track, lane?.active === slot.id ? null : slot)}>{lane?.active === slot.id ? 'Stop' : 'Launch'}</button>
      <button type="button" role="menuitem" onclick={() => studio.duplicateClip(track, slot)} disabled={!track.slots.some((c, i) => i > menu!.scene && !c)}>Duplicate to next empty</button>
      <button type="button" role="menuitem" onclick={() => patternView.clear(slot)} disabled={!slot.notes.length}>Clear notes</button>
      <button type="button" role="menuitem" data-destructive onclick={() => studio.removeClip(track, slot.id)}>Delete pattern</button>
    {:else}
      {@const index = menu.scene}
      <button type="button" role="menuitem" onclick={() => studio.addSlotClip(track, index)}>New pattern</button>
    {/if}
  </Menu>
{/if}
