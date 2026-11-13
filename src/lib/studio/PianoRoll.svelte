<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity'
  import { engine } from '../audio/engine.svelte'
  import { noteName } from '../input/keymaps'
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import Select, { type Option } from '../ui/Select.svelte'
  import Toolbar, { type ToolItem } from '../ui/Toolbar.svelte'
  import { QUANTIZE_GRIDS, snap, type Clip, type ClipNote, type Track } from './project'
  import { isKit, studio } from './studio.svelte'

  let { track, clip, channel, color }: { track: Track; clip: Clip; channel: number; color: string } = $props()

  const compact = new MediaQuery('(pointer: coarse)')
  const ZOOMS = [16, 24, 32, 48, 64, 96, 128]
  const EDGE = 8
  const DRAG_SLOP = 3
  const AUDITION_MS = 220
  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false]
  const GRID_NAMES: Record<number, string> = { 1: '1/4', 0.5: '1/8', 0.25: '1/16', [1 / 3]: '1/8 triplet', 0.125: '1/32' }
  const gridOptions: Option[] = QUANTIZE_GRIDS.filter(Boolean).map((g) => ({ value: String(g), label: GRID_NAMES[g] }))
  const quantizeOptions: Option[] = QUANTIZE_GRIDS.map((g) => ({ value: String(g), label: g ? `Quantize ${GRID_NAMES[g]}` : 'No quantize' }))
  const PITCHES = Array.from({ length: 128 }, (_, i) => 127 - i)

  let zoomIndex = $state(3)
  let grid = $state(0.25)
  let selected = $state(new Set<ClipNote>())
  let scroller: HTMLDivElement

  const kit = $derived(isKit(track))
  /** Kit tracks show one row per pad, named; other tracks show every pitch. */
  const rows = $derived(
    kit
      ? [...track.pads].sort((a, b) => b.midi - a.midi).map((pad) => ({ pitch: pad.midi, label: pad.name }))
      : PITCHES.map((pitch) => ({ pitch, label: pitch % 12 === 0 ? noteName(pitch) : '' })),
  )
  const rowOf = $derived(new Map(rows.map((r, i) => [r.pitch, i])))
  const keys = $derived(kit ? 96 : 44)
  const scene = $derived(track.slots.findIndex((c) => c?.id === clip.id))
  /** Clip-local playhead: session clips loop from their launch, timeline clips follow the song. */
  const playhead = $derived.by(() => {
    if (scene >= 0) {
      const lane = studio.laneOf(track)
      return lane?.active === clip.id ? (((studio.beat - lane.origin) % clip.length) + clip.length) % clip.length : null
    }
    const local = studio.position - clip.start
    return local >= 0 && local < clip.length ? local : null
  })
  const row = $derived(kit ? (compact.current ? 28 : 22) : compact.current ? 20 : 14)
  const zoom = $derived(ZOOMS[zoomIndex])
  const bar = $derived(studio.project.beatsPerBar)
  const width = $derived(clip.length * zoom)

  type Drag = { kind: 'move' | 'resize'; x: number; y: number; origins: Map<ClipNote, ClipNote>; moved: boolean; lastPitch: number }
  let drag: Drag | null = null

  $effect(() => {
    void clip.id
    selected = new Set()
    const notes = clip.notes
    const center = notes.length ? notes.reduce((sum, n) => sum + n.pitch, 0) / notes.length : 60
    queueMicrotask(() => scroller && (scroller.scrollTop = (rowOf.get(Math.round(center)) ?? 127 - center) * row - scroller.clientHeight / 2))
  })

  function audition(pitch: number, velocity = 0.7) {
    const voice = engine.noteOn(pitch, velocity, channel)
    setTimeout(() => voice.stop(), AUDITION_MS)
  }

  const point = (e: MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { beat: (e.clientX - rect.left) / zoom, pitch: rows[Math.floor((e.clientY - rect.top) / row)]?.pitch ?? -1 }
  }

  function onGridClick(e: MouseEvent) {
    const { beat, pitch } = point(e)
    const start = Math.floor(beat / grid) * grid
    if (start >= clip.length || pitch < 0 || pitch > 127) return
    const note: ClipNote = { pitch, start, length: grid, velocity: 0.8 }
    studio.edit(() => clip.notes.push(note))
    selected = new Set([clip.notes.at(-1)!])
    audition(pitch)
  }

  function onNoteDown(e: PointerEvent, note: ClipNote) {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (e.shiftKey) selected = new Set(selected.has(note) ? [...selected].filter((n) => n !== note) : [...selected, note])
    else if (!selected.has(note)) selected = new Set([note])
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    drag = {
      kind: rect.right - e.clientX < EDGE ? 'resize' : 'move',
      x: e.clientX,
      y: e.clientY,
      origins: new Map([...selected].map((n) => [n, { ...n }])),
      moved: false,
      lastPitch: note.pitch,
    }
    audition(note.pitch, note.velocity)
  }

  function onMove(e: PointerEvent) {
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_SLOP) return
      drag.moved = true
      studio.commit()
    }
    const beats = Math.round(dx / zoom / grid) * grid
    const steps = Math.round(dy / row)
    for (const [note, origin] of drag.origins) {
      if (drag.kind === 'resize') {
        note.length = Math.max(grid, origin.length + beats)
      } else {
        note.start = Math.max(0, Math.min(clip.length - grid, origin.start + beats))
        const index = Math.max(0, Math.min(rows.length - 1, (rowOf.get(origin.pitch) ?? 0) + steps))
        note.pitch = rows[index].pitch
      }
    }
    const lead = [...drag.origins.keys()][0]
    if (lead && lead.pitch !== drag.lastPitch) {
      drag.lastPitch = lead.pitch
      audition(lead.pitch)
    }
  }

  function remove() {
    if (!selected.size) return
    studio.edit(() => (clip.notes = clip.notes.filter((n) => !selected.has(n))))
    selected = new Set()
  }

  function resizeClip(bars: number) {
    const length = Math.max(bar, clip.length + bars * bar)
    studio.edit(() => {
      if (clip.repeat >= clip.length) clip.repeat = length
      clip.length = length
    })
  }

  const items: ToolItem[] = $derived([
    { id: 'where', label: 'Clip', priority: 1, content: where, menu: where },
    { id: 'grid', label: 'Grid', priority: 7, content: gridSelect, menu: gridSelect },
    { id: 'quantize', label: 'Quantize', priority: 6, content: quantizeSelect, menu: quantizeSelect },
    { id: 'length', label: 'Clip length', priority: 5, content: lengthControl, menu: lengthControl },
    { id: 'zoom-out', label: 'Zoom out', icon: 'minus', priority: 4, onclick: () => (zoomIndex = Math.max(0, zoomIndex - 1)) },
    { id: 'zoom-in', label: 'Zoom in', icon: 'plus', priority: 4, onclick: () => (zoomIndex = Math.min(ZOOMS.length - 1, zoomIndex + 1)) },
    { id: 'gap', spacer: true },
    { id: 'delete-notes', label: 'Delete notes (Del)', icon: 'trash', priority: 8, disabled: !selected.size, onclick: remove },
    { id: 'duplicate', label: 'Duplicate clip after itself', icon: 'copy', priority: 3, onclick: () => studio.duplicateClip(track, clip) },
    { id: 'delete-clip', label: 'Delete clip', text: 'Delete clip', priority: 2, onclick: () => studio.removeClip(track, clip.id) },
  ])

  function onKey(e: KeyboardEvent) {
    if ((e.code === 'Delete' || (e.code === 'Backspace' && selected.size)) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault()
      e.stopPropagation()
      remove()
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} />

{#snippet where()}
  <span class="truncate px-1 text-xs text-muted">{track.name} · {scene >= 0 ? `scene ${studio.project.scenes[scene]?.name}` : `bar ${Math.floor(clip.start / bar) + 1}`}</span>
{/snippet}

{#snippet gridSelect()}
  <div class="w-28"><Select bind:value={() => String(grid), (v) => (grid = Number(v))} options={gridOptions} /></div>
{/snippet}

{#snippet quantizeSelect()}
  <div class="w-40"><Select bind:value={() => String(clip.quantize), (v) => studio.edit(() => (clip.quantize = Number(v)))} options={quantizeOptions} /></div>
{/snippet}

{#snippet lengthControl()}
  <div class="flex items-center" title="Clip length">
    <Button variant="ghost" shape="square" onclick={() => resizeClip(-1)} aria-label="Shorter clip"><Icon name="minus" /></Button>
    <span class="min-w-[5ch] text-center text-xs tabular-nums">{Math.round((clip.length / bar) * 100) / 100} bar</span>
    <Button variant="ghost" shape="square" onclick={() => resizeClip(1)} aria-label="Longer clip"><Icon name="plus" /></Button>
  </div>
{/snippet}

<div class="grid h-full min-h-0 grid-rows-[auto_1fr]">
  <div class="flex border-b border-line px-2 py-1">
    <Toolbar label="Notes" {items} />
  </div>

  <div bind:this={scroller} class="relative min-h-0 overflow-auto overscroll-contain" role="group" aria-label="Note grid" onpointermove={onMove} onpointerup={() => (drag = null)} onpointercancel={() => (drag = null)}>
    <div class="relative flex" style:height="{rows.length * row}px" style:width="{keys + width}px">
      <div class="sticky left-0 z-10 shrink-0 bg-surface" style:width="{keys}px">
        {#each rows as { pitch, label } (pitch)}
          <button
            type="button"
            class={[
              'block w-full cursor-pointer truncate border-b border-black/30 pr-1 text-right text-[10px]',
              kit ? 'bg-raised pl-2 text-left text-fg' : BLACK[pitch % 12] ? 'bg-raised text-muted' : 'bg-fg/85 text-bg/70',
            ]}
            style:height="{row}px"
            onpointerdown={() => audition(pitch)}
            tabindex="-1">{label}</button
          >
        {/each}
      </div>
      <div
        class="relative"
        style:width="{width}px"
        style:background-image="repeating-linear-gradient(90deg, #ffffff22 0 1px, transparent 1px {bar * zoom}px), repeating-linear-gradient(90deg, #ffffff0d 0 1px, transparent 1px {zoom}px), repeating-linear-gradient(180deg, #ffffff08 0 1px, transparent 1px {row}px)"
        onclick={onGridClick}
        role="presentation"
      >
        {#if clip.repeat < clip.length}
          <div class="pointer-events-none absolute inset-y-0 right-0 bg-black/40" style:left="{clip.repeat * zoom}px"></div>
        {/if}
        {#each clip.notes as note, i (i)}
          {@const start = snap(note.start, clip.quantize)}
          {@const index = rowOf.get(note.pitch)}
          {#if index !== undefined}
          <div
            class={['absolute cursor-grab touch-none rounded-[3px]', selected.has(note) && 'ring-2 ring-fg']}
            style:left="{start * zoom}px"
            style:top="{index * row + 1}px"
            style:width="{Math.max(4, note.length * zoom - 1)}px"
            style:height="{row - 2}px"
            style:background={color}
            style:opacity={0.45 + note.velocity * 0.55}
            onpointerdown={(e) => onNoteDown(e, note)}
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.key === 'Enter' && (selected = new Set([note]))}
            role="button"
            tabindex="0"
            aria-label="{noteName(note.pitch)} at beat {Math.round(start * 100) / 100 + 1}"
          >
            <span class="absolute inset-y-0 right-0 w-2 cursor-ew-resize"></span>
          </div>
          {/if}
        {/each}
        {#if playhead !== null}
          <div class="pointer-events-none absolute inset-y-0 w-px bg-accent" style:left="{playhead * zoom}px"></div>
        {/if}
      </div>
    </div>
  </div>
</div>
