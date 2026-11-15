<script lang="ts" module>
  /** Pixels per beat at each zoom step. */
  export const ZOOMS = [16, 24, 32, 48, 64, 96, 128]
</script>

<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { preserveScroll, restoreScroll } from '../ui/adaptive'
  import { MediaQuery } from 'svelte/reactivity'
  import { engine } from '../audio/engine.svelte'
  import { noteName } from '../input/keymaps'
  import { patternView } from './pattern.svelte'
  import { snap, type Clip, type ClipNote, type Track } from './project'
  import { isKit, studio } from './studio.svelte'

  /**
   * Notes of one clip on a pitch × time grid; the device knobs drive snap, quantize, zoom and length.
   * Click empty space to add a note, drag on it to select; drag notes to move, their right edge to resize,
   * Alt-drag to copy; double-click or right-click a note to delete it; ⌘/Ctrl-scroll zooms. The selection is the
   * Pattern screen's (shared with the step grid); its keys live there.
   * Touch: tap adds or removes a note, drag a note to move it (its end to resize), swipe to scroll, pinch to zoom,
   * hold still on empty space to draw a selection box.
   */
  let {
    track,
    clip,
    channel,
    color,
    grid = $bindable(0.25),
    zoomIndex = $bindable(3),
  }: { track: Track; clip: Clip; channel: number; color: string; grid?: number; zoomIndex?: number } = $props()

  const compact = new MediaQuery('(pointer: coarse)')
  const EDGE = 8
  /** A fingertip needs a wider grip on a note's end to resize it. */
  const TOUCH_EDGE = 18
  /** Touch: a still finger this long on empty space starts a selection box instead of scrolling. */
  const HOLD_MS = 350
  /** Pinch distance ratio per zoom step. */
  const PINCH_STEP = 1.25
  const DRAG_SLOP = 3
  const AUDITION_MS = 220
  const DEFAULT_VELOCITY = 0.8
  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false]
  const PITCHES = Array.from({ length: 128 }, (_, i) => 127 - i)

  const selected = $derived(new Set(patternView.selection(clip)))
  let scroller: HTMLDivElement
  let lane: HTMLDivElement
  let marquee = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

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
  const row = $derived(kit ? (compact.current ? 32 : 22) : compact.current ? 28 : 18)
  const zoom = $derived(ZOOMS[zoomIndex])
  const bar = $derived(studio.project.beatsPerBar)
  const width = $derived(clip.length * zoom)

  type Drag = { kind: 'move' | 'resize'; x: number; y: number; origins: Map<ClipNote, ClipNote>; moved: boolean; lastPitch: number; copy: boolean; touch: ClipNote | null }
  let drag: Drag | null = null

  $effect(() => {
    void clip.id
    const notes = untrack(() => clip.notes)
    const center = notes.length ? notes.reduce((sum, n) => sum + n.pitch, 0) / notes.length : 60
    queueMicrotask(() => scroller && !restoreScroll(scroller, `notes:${clip.id}`) && (scroller.scrollTop = (rowOf.get(Math.round(center)) ?? 127 - center) * row - scroller.clientHeight / 2))
  })

  function audition(pitch: number, velocity = 0.7) {
    const voice = engine.noteOn(pitch, velocity, channel)
    setTimeout(() => voice.stop(), AUDITION_MS)
  }

  const local = (e: MouseEvent) => {
    const rect = lane.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  /** Fingers on the lane: where each is, for scrolling with one and zooming with two. */
  const fingers = new Map<number, { x: number; y: number }>()

  /**
   * A finger on empty space: a tap adds a note, a swipe scrolls, two fingers pinch to zoom, and a finger held still
   * first draws a selection box (as a mouse drag does).
   */
  function onLaneTouch(e: PointerEvent) {
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (fingers.size > 1) return // The first finger's handler turns into a pinch.
    lane.setPointerCapture(e.pointerId)
    const origin = { left: scroller.scrollLeft, top: scroller.scrollTop }
    let mode: 'wait' | 'pan' | 'pinch' | 'box' = 'wait'
    let spread = 0
    const distance = () => {
      const [a, b] = [...fingers.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const timer = setTimeout(() => {
      if (mode !== 'wait') return
      mode = 'box'
      navigator.vibrate?.(8)
      stop()
      onMouseLane(e)
    }, HOLD_MS)
    const move = (event: PointerEvent) => {
      if (!fingers.has(event.pointerId)) return
      fingers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (fingers.size > 1) {
        if (mode !== 'pinch') ((mode = 'pinch'), (spread = distance()))
        const ratio = distance() / Math.max(1, spread)
        if (ratio > PINCH_STEP || ratio < 1 / PINCH_STEP) {
          zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, zoomIndex + (ratio > 1 ? 1 : -1)))
          spread = distance()
        }
        return
      }
      if (event.pointerId !== e.pointerId || mode === 'pinch') return
      const dx = event.clientX - e.clientX
      const dy = event.clientY - e.clientY
      if (mode === 'wait' && Math.hypot(dx, dy) > DRAG_SLOP * 3) mode = 'pan'
      if (mode !== 'pan') return
      scroller.scrollLeft = origin.left - dx
      scroller.scrollTop = origin.top - dy
    }
    const lift = (event: PointerEvent) => {
      fingers.delete(event.pointerId)
      if (event.pointerId !== e.pointerId && fingers.size) return
      clearTimeout(timer)
      stop()
      fingers.clear()
      if (mode === 'wait' && event.type === 'pointerup') {
        const at = local(e)
        patternView.insert = Math.max(0, Math.min(clip.length, Math.floor(at.x / zoom / grid) * grid))
        addAt(at.x, at.y)
      }
    }
    const stop = () => {
      lane.removeEventListener('pointermove', move)
      lane.removeEventListener('pointerup', lift)
      lane.removeEventListener('pointercancel', lift)
    }
    lane.addEventListener('pointermove', move)
    lane.addEventListener('pointerup', lift)
    lane.addEventListener('pointercancel', lift)
  }

  function onLaneDown(e: PointerEvent) {
    if (e.pointerType === 'touch' && !e.shiftKey) return onLaneTouch(e)
    onMouseLane(e)
  }

  /** Empty space: a click adds a note, a drag selects the notes it covers (Shift adds to the selection). */
  function onMouseLane(e: PointerEvent) {
    if (e.button !== 0) return
    lane.setPointerCapture(e.pointerId)
    scroller.focus({ preventScroll: true })
    const start = local(e)
    patternView.insert = Math.max(0, Math.min(clip.length, Math.floor(start.x / zoom / grid) * grid))
    const keep = e.shiftKey ? new Set(selected) : new Set<ClipNote>()
    let moved = false
    const move = (event: PointerEvent) => {
      const at = local(event)
      if (!moved && Math.hypot(at.x - start.x, at.y - start.y) < DRAG_SLOP) return
      moved = true
      marquee = { x0: start.x, y0: start.y, x1: at.x, y1: at.y }
      const [left, right] = [Math.min(start.x, at.x) / zoom, Math.max(start.x, at.x) / zoom]
      const [top, bottom] = [Math.floor(Math.min(start.y, at.y) / row), Math.floor(Math.max(start.y, at.y) / row)]
      const hit = clip.notes.filter((n) => {
        const index = rowOf.get(n.pitch) ?? -1
        const begin = snap(n.start, clip.quantize)
        return index >= top && index <= bottom && begin < right && begin + n.length > left
      })
      patternView.select([...keep, ...hit])
    }
    const up = () => {
      lane.removeEventListener('pointermove', move)
      lane.removeEventListener('pointerup', up)
      lane.removeEventListener('pointercancel', up)
      marquee = null
      if (!moved && e.shiftKey) patternView.select(keep)
      else if (!moved) addAt(start.x, start.y)
    }
    lane.addEventListener('pointermove', move)
    lane.addEventListener('pointerup', up)
    lane.addEventListener('pointercancel', up)
  }

  function addAt(x: number, y: number) {
    const pitch = rows[Math.floor(y / row)]?.pitch ?? -1
    const start = Math.floor(x / zoom / grid) * grid
    if (start >= clip.length || pitch < 0 || pitch > 127) return
    const note: ClipNote = { pitch, start, length: grid, velocity: DEFAULT_VELOCITY }
    studio.edit(() => clip.notes.push(note))
    patternView.select([clip.notes.at(-1)!])
    audition(pitch)
  }

  function onNoteDown(e: PointerEvent, note: ClipNote) {
    e.stopPropagation()
    if (e.button === 2) return
    scroller.focus({ preventScroll: true })
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (e.shiftKey) patternView.select(selected.has(note) ? [...selected].filter((n) => n !== note) : [...selected, note])
    else if (!selected.has(note)) patternView.select([note])
    patternView.insert = Math.floor(note.start / grid) * grid
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    drag = {
      kind: rect.right - e.clientX < (e.pointerType === 'touch' ? Math.min(TOUCH_EDGE, rect.width / 2) : EDGE) ? 'resize' : 'move',
      x: e.clientX,
      y: e.clientY,
      origins: new Map(patternView.selection(clip).map((n) => [n, { ...n }])),
      moved: false,
      lastPitch: note.pitch,
      copy: e.altKey,
      // A finger has no right-click or reliable double-tap: tapping a note removes it, as tapping a step does.
      touch: e.pointerType === 'touch' ? note : null,
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
      // Alt-drag leaves copies where the notes were and moves the originals.
      if (drag.copy && drag.kind === 'move') clip.notes.push(...[...drag.origins.values()].map((n) => ({ ...n })))
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

  function deleteNotes(notes: Set<ClipNote>) {
    if (!notes.size) return
    studio.edit(() => (clip.notes = clip.notes.filter((n) => !notes.has(n))))
  }

  async function onWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const x = e.clientX - scroller.getBoundingClientRect().left
    const beat = (scroller.scrollLeft + x - keys) / zoom
    zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, zoomIndex + (e.deltaY < 0 ? 1 : -1)))
    await tick()
    scroller.scrollLeft = Math.max(0, beat * zoom - x + keys)
  }
</script>

<div class="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[1fr]">
  <div
    bind:this={scroller}
    use:preserveScroll={`notes:${clip.id}`}
    class="relative min-h-0 overflow-auto overscroll-contain outline-none"
    role="group"
    tabindex="-1"
    data-pattern-editor
    aria-label="Note grid"
    onpointermove={onMove}
    onpointerup={() => {
      if (drag?.touch && !drag.moved) deleteNotes(new Set([drag.touch]))
      drag = null
    }}
    onpointercancel={() => (drag = null)}
    onwheel={onWheel}
    oncontextmenu={(e) => e.preventDefault()}
  >
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
            title="Hear {noteName(pitch)}"
            tabindex="-1">{label}</button
          >
        {/each}
      </div>
      <div
        bind:this={lane}
        class="relative touch-none"
        style:width="{width}px"
        style:background-image="repeating-linear-gradient(90deg, var(--color-grid-strong) 0 1px, transparent 1px {bar * zoom}px), repeating-linear-gradient(90deg, var(--color-grid) 0 1px, transparent 1px {zoom}px), repeating-linear-gradient(180deg, var(--color-grid-faint) 0 1px, transparent 1px {row}px)"
        onpointerdown={onLaneDown}
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
              ondblclick={(e) => (e.stopPropagation(), deleteNotes(new Set([note])))}
              oncontextmenu={(e) => (e.preventDefault(), e.stopPropagation(), deleteNotes(new Set([note])))}
              onkeydown={(e) => e.key === 'Enter' && patternView.select([note])}
              role="button"
              tabindex="-1"
              aria-label="{noteName(note.pitch)} at beat {Math.round(start * 100) / 100 + 1}"
            >
              <span class="absolute inset-y-0 right-0 w-2 cursor-ew-resize"></span>
            </div>
          {/if}
        {/each}
        {#if marquee}
          <div
            class="pointer-events-none absolute border border-fg/70 bg-fg/10"
            style:left="{Math.min(marquee.x0, marquee.x1)}px"
            style:top="{Math.min(marquee.y0, marquee.y1)}px"
            style:width="{Math.abs(marquee.x1 - marquee.x0)}px"
            style:height="{Math.abs(marquee.y1 - marquee.y0)}px"
          ></div>
        {/if}
        <div class="pointer-events-none absolute inset-y-0 w-0 border-l-2 border-dashed border-accent/70" style:left="{patternView.insert * zoom}px"></div>
        {#if playhead !== null}
          <div class="pointer-events-none absolute inset-y-0 w-px bg-accent" style:left="{playhead * zoom}px"></div>
        {/if}
      </div>
    </div>
  </div>
</div>
