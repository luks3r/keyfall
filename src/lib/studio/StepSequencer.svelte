<script lang="ts">
  import { untrack } from 'svelte'
  import { preserveScroll, restoreScroll } from '../ui/adaptive'
  import { MediaQuery } from 'svelte/reactivity'
  import { engine } from '../audio/engine.svelte'
  import { focusedByKeyboard } from '../input/focus'
  import { noteName } from '../input/keymaps'
  import { live, SCALES } from './live.svelte'
  import { notesIn, patternView } from './pattern.svelte'
  import { stepOf, type Clip, type ClipNote, type Track } from './project'
  import { isKit, studio, trackChannel } from './studio.svelte'

  /**
   * Step grid of one clip.
   * Mouse: click an empty step to add it, drag on to lengthen it (drums: paint more steps); click a step to remove
   * it, drag it up/down for velocity or sideways for length; right-click or right-drag erases. Shift-click selects,
   * Shift-drag selects a box; the selection is shared with the note grid (copy, paste, move: see PatternScreen).
   * Keyboard (grid focused): arrows move the cursor, Enter toggles, Delete removes, Shift+←/→ length, Shift+↑/↓ velocity.
   * Step input (notes from the keyboard or MIDI) writes at the red cursor; see `studio.stepInput`.
   */
  let { track, clip, color }: { track: Track; clip: Clip; color: string } = $props()

  const coarse = new MediaQuery('(pointer: coarse)')
  /** Touch: a still finger this long starts editing (paint, velocity, length); moving sooner scrolls instead. */
  const HOLD_MS = 350
  /** Narrowest step a fingertip can hit. */
  const TOUCH_STEP = 40
  const AUDITION_MS = 180
  const EPSILON = 1e-6
  const DRAG_SLOP = 4
  /** Pixels of vertical drag per full velocity range. */
  const VELOCITY_RANGE = 120
  const VELOCITY_STEP = 0.1
  const MIN_VELOCITY = 0.05
  const OCTAVE_SPAN = 24

  let width = $state(0)
  let scroller: HTMLDivElement
  let surface: HTMLDivElement
  let focused = $state(false)
  let cursor = $state({ step: 0, row: 0 })
  let hint = $state<{ step: number; row: number; text: string } | null>(null)
  let box = $state<{ from: { step: number; row: number }; to: { step: number; row: number } } | null>(null)
  const resolution = $derived(stepOf(clip))

  const kit = $derived(isKit(track))
  const steps = $derived(Math.max(1, Math.round(clip.length / resolution)))
  /** Steps are drawn in groups of 4 (3 for triplets) and rows of four groups, at any speed, like a drum machine. */
  const group = $derived(Math.round(1 / resolution) % 3 === 0 ? 3 : 4)
  /** Row names: narrower on phones, where every step counts. */
  const LABEL = $derived(coarse.current && width < 600 ? 52 : 76)
  /** Touch: whole groups of fingertip-wide steps per screen ("page"); the grid scrolls a page at a time. */
  const perPage = $derived(coarse.current ? Math.max(group, Math.floor((width - LABEL) / TOUCH_STEP / group) * group) : steps)
  const paged = $derived(coarse.current && steps > perPage)
  const stepWidth = $derived(paged ? (width - LABEL) / perPage : Math.max(coarse.current ? TOUCH_STEP : 22, Math.min(48, (width - LABEL) / steps)))
  const pages = $derived(paged ? Math.ceil(steps / perPage) : 1)
  let scrollLeft = $state(0)
  const page = $derived(Math.round(scrollLeft / (perPage * stepWidth)))
  /** The last time a finger scrolled the grid; the playhead leaves the view alone for a moment after. */
  let touched = 0

  function showPage(index: number, smooth = true) {
    scroller?.scrollTo({ left: index * perPage * stepWidth, behavior: smooth ? 'smooth' : 'instant' })
  }

  /** Touch, playing: turn the page with the playhead, unless a finger just moved the grid. */
  $effect(() => {
    if (!paged || playStep < 0 || performance.now() - touched < 2000) return
    const target = Math.floor(playStep / perPage)
    if (target !== untrack(() => page)) showPage(target)
  })
  const rowHeight = $derived(coarse.current ? 44 : 26)
  /**
   * Kit tracks: one row per pad, kick first as on drum machines. Melodic tracks: two octaves of the live scale from
   * `base`, highest first, plus a row for every note the clip holds so nothing written is ever hidden.
   */
  const rows = $derived.by(() => {
    const pitches = new Set(clip.notes.map((n) => n.pitch))
    if (kit) {
      const pads = new Map(track.pads.map((pad) => [pad.midi, pad.name]))
      return [...new Set([...pads.keys(), ...pitches])].sort((a, b) => a - b).map((pitch) => ({ pitch, label: pads.get(pitch) ?? noteName(pitch) }))
    }
    const degrees: readonly number[] = SCALES[live.settings.scale]
    for (let pitch = patternView.base; pitch <= Math.min(127, patternView.base + OCTAVE_SPAN); pitch++) {
      if (degrees.includes((((pitch - live.settings.root) % 12) + 12) % 12)) pitches.add(pitch)
    }
    return [...pitches].sort((a, b) => b - a).map((pitch) => ({ pitch, label: noteName(pitch) }))
  })
  const channel = $derived(trackChannel(studio.project.tracks.indexOf(track)))
  const stepping = $derived(studio.stepInput?.clip === clip.id ? studio.stepInput : null)
  const column = $derived(stepping ? stepping.cursor : Math.min(cursor.step, steps - 1))
  const row = $derived(Math.min(cursor.row, rows.length - 1))
  const playStep = $derived.by(() => {
    const scene = track.slots.findIndex((c) => c?.id === clip.id)
    let local: number | null = null
    if (scene >= 0) {
      const lane = studio.laneOf(track)
      if (lane?.active === clip.id) local = (((studio.beat - lane.origin) % clip.length) + clip.length) % clip.length
    } else if (studio.playing && studio.position >= clip.start && studio.position < clip.start + clip.length) {
      local = studio.position - clip.start
    }
    return local === null ? -1 : Math.floor(local / resolution)
  })

  /** Opening a clip shows the octave its notes start in; editing never moves the view. */
  $effect(() => {
    void clip.id
    const notes = untrack(() => clip.notes)
    if (kit || !notes.length) return
    const lowest = Math.min(...notes.map((n) => n.pitch))
    patternView.base = Math.max(0, Math.min(103, lowest - (lowest % 12)))
  })

  /** Melodic rows start at `base` at the bottom, where the clip's notes are; open there. */
  $effect(() => {
    void [clip.id, patternView.base]
    if (!kit) queueMicrotask(() => scroller && !restoreScroll(scroller, `steps:${clip.id}:${patternView.base}`) && (scroller.scrollTop = scroller.scrollHeight))
  })

  $effect(() => {
    const input = studio.stepInput
    if (input?.clip === clip.id && input.resolution !== resolution) {
      input.cursor = Math.round((input.cursor * input.resolution) / resolution) % steps
      input.resolution = resolution
    }
  })

  /** Keeps the cursor on screen as it moves. */
  $effect(() => {
    if (!scroller || (!focused && !stepping)) return
    const left = LABEL + column * stepWidth
    const top = row * rowHeight
    if (left - LABEL < scroller.scrollLeft) scroller.scrollLeft = left - LABEL
    else if (left + stepWidth > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = left + stepWidth - scroller.clientWidth
    if (focused) {
      if (top < scroller.scrollTop) scroller.scrollTop = top
      else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + rowHeight - scroller.clientHeight
    }
  })

  function audition(pitch: number, velocity = 0.8) {
    const voice = engine.noteOn(pitch, velocity, channel)
    setTimeout(() => voice.stop(), AUDITION_MS)
  }

  /** Notes touching a cell, wherever they start: recorded notes rarely sit on the grid. */
  const notesAt = (pitch: number, step: number) => notesIn(clip, pitch, step * resolution, (step + 1) * resolution)
  const noteAt = (pitch: number, step: number) => notesAt(pitch, step)[0]
  const selectedNotes = $derived(new Set(patternView.selection(clip)))

  const cellAt = (e: PointerEvent) => {
    const rect = surface.getBoundingClientRect()
    return { step: Math.floor((e.clientX - rect.left - LABEL) / stepWidth), row: Math.floor((e.clientY - rect.top) / rowHeight) }
  }
  const inside = (cell: { step: number; row: number }) => cell.step >= 0 && cell.step < steps && cell.row >= 0 && cell.row < rows.length

  function add(pitch: number, step: number) {
    const note: ClipNote = { pitch, start: step * resolution, length: resolution, velocity: patternView.velocity }
    clip.notes.push(note)
    return clip.notes.at(-1)!
  }

  const removeAll = (notes: ClipNote[]) => {
    const gone = new Set(notes)
    clip.notes = clip.notes.filter((n) => !gone.has(n))
  }
  const remove = (note: ClipNote) => removeAll([note])

  /** Notes inside the box spanned by two cells. */
  function inBox(a: { step: number; row: number }, b: { step: number; row: number }) {
    const [top, bottom] = [Math.min(a.row, b.row), Math.max(a.row, b.row)]
    const [left, right] = [Math.min(a.step, b.step), Math.max(a.step, b.step)]
    const pitches = new Set(rows.slice(top, bottom + 1).map((r) => r.pitch))
    return clip.notes.filter((n) => pitches.has(n.pitch) && n.start < (right + 1) * resolution - EPSILON && n.start + n.length > left * resolution + EPSILON)
  }

  /**
   * A finger on the grid: a tap toggles the step, a quick swipe scrolls the grid, and a finger held still first
   * edits like a mouse drag (paint steps, drag velocity or length).
   */
  function onTouch(e: PointerEvent) {
    const start = cellAt(e)
    if (!inside(start)) return
    e.preventDefault()
    surface.setPointerCapture(e.pointerId)
    const origin = { left: scroller.scrollLeft, top: scroller.scrollTop }
    let mode: 'wait' | 'pan' | 'edit' = 'wait'
    const timer = setTimeout(() => {
      if (mode !== 'wait') return
      mode = 'edit'
      navigator.vibrate?.(8)
      stop()
      edit(e, start)
    }, HOLD_MS)
    const move = (event: PointerEvent) => {
      const dx = event.clientX - e.clientX
      const dy = event.clientY - e.clientY
      if (mode === 'wait' && Math.hypot(dx, dy) > DRAG_SLOP * 2) mode = 'pan'
      if (mode !== 'pan') return
      touched = performance.now()
      scroller.scrollLeft = origin.left - dx
      scroller.scrollTop = origin.top - dy
    }
    const stop = () => {
      surface.removeEventListener('pointermove', move)
      surface.removeEventListener('pointerup', up)
      surface.removeEventListener('pointercancel', cancel)
    }
    const up = () => {
      clearTimeout(timer)
      stop()
      if (mode !== 'wait') return
      // A tap: toggle the step.
      surface.focus({ preventScroll: true })
      focused = false
      cursor = start
      patternView.insert = start.step * resolution
      const pitch = rows[start.row].pitch
      const there = notesAt(pitch, start.step)
      studio.commit()
      if (there.length) removeAll(there)
      else {
        patternView.select([])
        audition(pitch, add(pitch, start.step).velocity)
      }
    }
    const cancel = () => {
      clearTimeout(timer)
      stop()
    }
    surface.addEventListener('pointermove', move)
    surface.addEventListener('pointerup', up)
    surface.addEventListener('pointercancel', cancel)
  }

  function onPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    if (e.pointerType === 'touch' && !e.shiftKey) return onTouch(e)
    const start = cellAt(e)
    if (!inside(start)) return
    e.preventDefault()
    edit(e, start)
  }

  /** Mouse (or a held finger): add, remove, paint, select, erase, velocity and length, as described at the top. */
  function edit(e: PointerEvent, start: { step: number; row: number }) {
    surface.focus({ preventScroll: true })
    focused = false
    cursor = start
    const pitch = rows[start.row].pitch
    const existing = noteAt(pitch, start.step)
    surface.setPointerCapture(e.pointerId)
    patternView.insert = start.step * resolution
    /** One undo step per gesture, taken at its first change. */
    let committed = false
    const change = (edit: () => void) => {
      if (!committed) studio.commit()
      committed = true
      edit()
    }

    let onMove: (event: PointerEvent) => void
    let onUp: () => void = () => {}
    if (e.button === 0 && e.shiftKey) {
      // Shift: select. A click toggles the cell's notes, a drag selects a box.
      const before = new Set(selectedNotes)
      let dragged = false
      onMove = (event) => {
        const cell = cellAt(event)
        if (!dragged && cell.step === start.step && cell.row === start.row) return
        dragged = true
        box = { from: start, to: { step: Math.max(0, Math.min(steps - 1, cell.step)), row: Math.max(0, Math.min(rows.length - 1, cell.row)) } }
        patternView.select([...before, ...inBox(box.from, box.to)])
      }
      onUp = () => {
        box = null
        if (dragged) return
        const cell = notesAt(pitch, start.step)
        const on = cell.some((n) => before.has(n))
        patternView.select(on ? [...before].filter((n) => !cell.includes(n)) : [...before, ...cell])
      }
    } else if (e.button === 2) {
      if (notesAt(pitch, start.step).length) change(() => removeAll(notesAt(pitch, start.step)))
      onMove = (event) => {
        const cell = cellAt(event)
        const hit = inside(cell) ? notesAt(rows[cell.row].pitch, cell.step) : []
        if (hit.length) change(() => removeAll(hit))
      }
    } else if (!existing) {
      patternView.select([])
      let note!: ClipNote
      change(() => (note = add(pitch, start.step)))
      audition(pitch, note.velocity)
      onMove = (event) => {
        const cell = cellAt(event)
        if (kit) {
          if (cell.step >= 0 && cell.step < steps && !noteAt(pitch, cell.step)) change(() => add(pitch, cell.step))
        } else {
          note.length = (Math.max(start.step, Math.min(steps - 1, cell.step)) - start.step + 1) * resolution
        }
      }
    } else {
      const velocity = existing.velocity
      let gesture: 'none' | 'velocity' | 'length' = 'none'
      onMove = (event) => {
        const dx = event.clientX - e.clientX
        const dy = event.clientY - e.clientY
        if (gesture === 'none') {
          if (Math.hypot(dx, dy) < DRAG_SLOP) return
          gesture = Math.abs(dy) > Math.abs(dx) || kit ? 'velocity' : 'length'
          change(() => {})
        }
        if (gesture === 'velocity') {
          existing.velocity = Math.max(MIN_VELOCITY, Math.min(1, velocity - dy / VELOCITY_RANGE))
          hint = { ...start, text: `${Math.round(existing.velocity * 100)}%` }
        } else {
          const last = Math.max(Math.round(existing.start / resolution), Math.min(steps - 1, cellAt(event).step))
          existing.length = Math.max(resolution, (last + 1) * resolution - existing.start)
          hint = { ...start, text: `${Math.round(existing.length / resolution)} steps` }
        }
      }
      onUp = () => {
        if (gesture === 'none') change(() => removeAll(notesAt(pitch, start.step)))
        else if (gesture === 'velocity') audition(pitch, existing.velocity)
      }
    }
    const up = () => {
      onUp()
      hint = null
      surface.removeEventListener('pointermove', onMove)
      surface.removeEventListener('pointerup', up)
      surface.removeEventListener('pointercancel', up)
    }
    surface.addEventListener('pointermove', onMove)
    surface.addEventListener('pointerup', up)
    surface.addEventListener('pointercancel', up)
  }

  function moveCursor(steps_: number, rows_: number) {
    if (stepping && steps_) studio.stepMove(steps_)
    cursor = {
      step: (((column + (stepping ? 0 : steps_)) % steps) + steps) % steps,
      row: Math.max(0, Math.min(rows.length - 1, row + rows_)),
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !rows.length) return
    if (e.key.startsWith('Arrow') || e.key === 'Enter') focused = true
    const pitch = rows[row].pitch
    const note = noteAt(pitch, column)
    const handled = () => (e.preventDefault(), e.stopPropagation())
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const direction = e.key === 'ArrowRight' ? 1 : -1
        handled()
        if (!e.shiftKey) return moveCursor(direction, 0)
        if (note && !kit) studio.edit(() => (note.length = Math.max(resolution, Math.min(clip.length - note.start, note.length + direction * resolution))))
        return
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        const direction = e.key === 'ArrowUp' ? 1 : -1
        handled()
        if (!e.shiftKey) return moveCursor(0, -direction)
        if (note) studio.tweak(() => (note.velocity = Math.max(MIN_VELOCITY, Math.min(1, Math.round((note.velocity + direction * VELOCITY_STEP) * 10) / 10))))
        return
      }
      case 'Home':
      case 'End':
        handled()
        return moveCursor((e.key === 'Home' ? 0 : steps - 1) - column, 0)
      case 'Enter':
        handled()
        if (note) return studio.edit(() => removeAll(notesAt(pitch, column)))
        studio.edit(() => add(pitch, column))
        return audition(pitch, patternView.velocity)
      case 'Delete':
      case 'Backspace':
        if (stepping && e.key === 'Backspace') return
        handled()
        if (note) studio.edit(() => removeAll(notesAt(pitch, column)))
    }
  }
</script>

<div class="grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
  <div bind:this={scroller} use:preserveScroll={`steps:${clip.id}:${patternView.base}`} class="min-h-0 overflow-auto overscroll-contain" bind:clientWidth={width} onscroll={() => (scrollLeft = scroller.scrollLeft)}>
    <div
      bind:this={surface}
      class="relative touch-none outline-none select-none"
      style:width="{LABEL + steps * stepWidth}px"
      role="grid"
      data-pattern-editor
      tabindex="0"
      aria-label="Step grid · {rows[row]?.label ?? ''} step {column + 1} · arrows move, Enter toggles"
      onpointerdown={onPointerDown}
      oncontextmenu={(e) => e.preventDefault()}
      onkeydown={onKey}
      onfocus={() => (focused = focusedByKeyboard())}
      onblur={() => (focused = false)}
    >
      {#each rows as { pitch, label } (pitch)}
        {@const accent = !kit && pitch % 12 === live.settings.root}
        <div class="flex border-b border-black/30" style:height="{rowHeight}px" role="row" aria-label="{label} steps">
          <button
            type="button"
            class={['sticky left-0 z-10 shrink-0 cursor-pointer truncate bg-display px-2 text-left text-xs', accent ? 'text-accent' : 'text-muted']}
            style:width="{LABEL}px"
            onpointerdown={() => audition(pitch)}
            title="Hear {label}"
            tabindex="-1">{label}</button
          >
          <div
            class="relative cursor-pointer"
            style:width="{steps * stepWidth}px"
            style:background-image="repeating-linear-gradient(90deg, var(--color-grid-strong) 0 1px, transparent 1px {stepWidth * group * 4}px), repeating-linear-gradient(90deg, var(--color-grid) 0 1px, transparent 1px {stepWidth * group}px), repeating-linear-gradient(90deg, var(--color-grid-faint) 0 1px, transparent 1px {stepWidth}px)"
          >
            {#each clip.notes as note, i (i)}
              {#if note.pitch === pitch}
                <span
                  class={['pointer-events-none absolute inset-y-1 rounded-[4px]', selectedNotes.has(note) && 'ring-2 ring-fg']}
                  style:left="{(note.start / resolution) * stepWidth + 1}px"
                  style:width="{Math.max(6, (note.length / resolution) * stepWidth - 2)}px"
                  style:background={color}
                  style:opacity={0.35 + note.velocity * 0.65}
                ></span>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
      <div class="pointer-events-none absolute inset-y-0 w-0 border-l-2 border-dashed border-accent/70" style:left="{LABEL + (patternView.insert / resolution) * stepWidth}px" title="Paste goes here"></div>
      {#if box}
        {@const left = Math.min(box.from.step, box.to.step)}
        {@const top = Math.min(box.from.row, box.to.row)}
        <div
          class="pointer-events-none absolute border border-fg/70 bg-fg/10"
          style:left="{LABEL + left * stepWidth}px"
          style:top="{top * rowHeight}px"
          style:width="{(Math.abs(box.to.step - box.from.step) + 1) * stepWidth}px"
          style:height="{(Math.abs(box.to.row - box.from.row) + 1) * rowHeight}px"
        ></div>
      {/if}
      {#if playStep >= 0}
        <div class="pointer-events-none absolute inset-y-0 bg-fg/10" style:left="{LABEL + playStep * stepWidth}px" style:width="{stepWidth}px"></div>
      {/if}
      {#if stepping}
        <div class="pointer-events-none absolute inset-y-0 border-2 border-danger/80" style:left="{LABEL + stepping.cursor * stepWidth}px" style:width="{stepWidth}px"></div>
      {/if}
      {#if focused}
        <div class="pointer-events-none absolute rounded-[4px] ring-2 ring-fg" style:left="{LABEL + column * stepWidth}px" style:top="{row * rowHeight}px" style:width="{stepWidth}px" style:height="{rowHeight}px"></div>
      {/if}
      {#if hint}
        <div class="pointer-events-none absolute z-20 -translate-y-full rounded bg-fg px-1.5 py-0.5 font-mono text-[10px] text-bg" style:left="{LABEL + hint.step * stepWidth}px" style:top="{hint.row * rowHeight}px">{hint.text}</div>
      {/if}
    </div>
  </div>
  {#if pages > 1}
    <!-- Touch: which part of the pattern shows; follows the playhead while it plays. -->
    <div class="flex gap-1 border-t border-line px-2 py-1" role="group" aria-label="Step pages">
      {#each { length: pages } as _, i (i)}
        {@const current = i === page}
        <button
          type="button"
          data-ui
          class={['label h-control-sm min-w-0 flex-1 cursor-pointer rounded-control', current ? 'bg-fg text-bg' : 'bg-raised text-fg', playStep >= 0 && Math.floor(playStep / perPage) === i && !current && 'ring-1 ring-fg/60']}
          aria-pressed={current}
          aria-label="Steps {i * perPage + 1} to {Math.min(steps, (i + 1) * perPage)}"
          onclick={() => ((touched = performance.now()), showPage(i))}>{i * perPage + 1}–{Math.min(steps, (i + 1) * perPage)}</button
        >
      {/each}
    </div>
  {/if}
</div>
