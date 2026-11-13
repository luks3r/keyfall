<script lang="ts" module>
  export const TRACK_COLORS = Array.from({ length: 8 }, (_, i) => `var(--color-track-${i + 1})`)
  export const trackColor = (index: number) => TRACK_COLORS[index % TRACK_COLORS.length]
</script>

<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity'
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import ClipPreview from './ClipPreview.svelte'
  import { clipEnd, projectEnd, type Clip, type Track } from './project'
  import { studio } from './studio.svelte'

  const compact = new MediaQuery('(max-width: 639px)')
  const ZOOMS = [8, 12, 16, 24, 32, 48, 64]
  const RULER = 28
  const ROW = 56
  const EDGE = 10
  const DRAG_SLOP = 3
  const EXTRA_BARS = 8

  let zoomIndex = $state(compact.current ? 2 : 3)
  const zoom = $derived(ZOOMS[zoomIndex])
  const header = $derived(compact.current ? 124 : 184)
  const project = $derived(studio.project)
  const bar = $derived(project.beatsPerBar)
  const beats = $derived(Math.ceil(projectEnd(project) / bar) * bar + EXTRA_BARS * bar)
  const width = $derived(beats * zoom)
  const bars = $derived(Array.from({ length: beats / bar }, (_, i) => i))

  type Drag = { kind: 'move' | 'resize' | 'loop-move' | 'loop-start' | 'loop-end'; x: number; origin: number; length: number; clip?: Clip; moved: boolean }
  let drag: Drag | null = null

  const beatAt = (e: PointerEvent | MouseEvent, element: HTMLElement) => (e.clientX - element.getBoundingClientRect().left) / zoom

  function startDrag(e: PointerEvent, next: Omit<Drag, 'x' | 'moved'>) {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag = { ...next, x: e.clientX, moved: false }
  }

  function onClipDown(e: PointerEvent, track: Track, clip: Clip) {
    studio.select(track.id, clip.id)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    startDrag(e, { kind: rect.right - e.clientX < EDGE ? 'resize' : 'move', origin: clip.start, length: clip.length, clip })
  }

  function onMove(e: PointerEvent) {
    if (!drag) return
    const delta = Math.round((e.clientX - drag.x) / zoom)
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x) < DRAG_SLOP) return
      drag.moved = true
      studio.commit()
    }
    const loop = project.loop
    switch (drag.kind) {
      case 'move':
        drag.clip!.start = Math.max(0, drag.origin + delta)
        break
      case 'resize': {
        const clip = drag.clip!
        const looped = clip.repeat < clip.length
        clip.length = Math.max(1, drag.length + delta)
        if (!looped) clip.repeat = clip.length
        break
      }
      case 'loop-move':
        loop.start = Math.max(0, drag.origin + delta)
        loop.end = loop.start + drag.length
        break
      case 'loop-start':
        loop.start = Math.max(0, Math.min(loop.end - 1, drag.origin + delta))
        break
      case 'loop-end':
        loop.end = Math.max(loop.start + 1, drag.origin + drag.length + delta)
        break
    }
  }

  function onUp() {
    drag = null
  }

  function onLaneClick(e: MouseEvent, track: Track) {
    if (studio.track?.id !== track.id) return studio.select(track.id)
    const start = Math.floor(beatAt(e, e.currentTarget as HTMLElement) / bar) * bar
    if (track.clips.some((c) => start >= c.start && start < clipEnd(c))) return
    studio.addClip(track, start)
  }

  function onRulerDown(e: PointerEvent) {
    studio.seek(Math.max(0, Math.round(beatAt(e, e.currentTarget as HTMLElement))))
  }

  function onWheel(e: WheelEvent) {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, zoomIndex + (e.deltaY < 0 ? 1 : -1)))
  }
</script>

<div class="relative min-h-0 overflow-auto overscroll-contain bg-bg" data-input-scope="arrangement" role="group" aria-label="Arrangement" onwheel={onWheel} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp}>
  <div class="relative min-w-full" style:width="{header + width}px" style:min-height="100%">
    <div class="sticky top-0 z-20 flex border-b border-line bg-surface" style:height="{RULER}px">
      <div class="sticky left-0 z-30 flex shrink-0 items-center justify-center gap-0.5 border-r border-line bg-surface" style:width="{header}px">
        <Button variant="ghost" shape="square" onclick={() => (zoomIndex = Math.max(0, zoomIndex - 1))} aria-label="Zoom out"><Icon name="minus" /></Button>
        <Button variant="ghost" shape="square" onclick={() => (zoomIndex = Math.min(ZOOMS.length - 1, zoomIndex + 1))} aria-label="Zoom in"><Icon name="plus" /></Button>
      </div>
      <div class="relative cursor-pointer touch-none" style:width="{width}px" onpointerdown={onRulerDown} role="slider" aria-label="Playhead" aria-valuenow={studio.position} tabindex="-1">
        {#each bars as i (i)}
          <span class="absolute bottom-1 border-l border-line pl-1 text-[11px] text-muted tabular-nums" style:left="{i * bar * zoom}px">{i + 1}</span>
        {/each}
        {#if project.loop.enabled}
          {@const loop = project.loop}
          <div
            class="absolute top-0.5 h-2.5 cursor-grab rounded-sm bg-accent/50"
            style:left="{loop.start * zoom}px"
            style:width="{(loop.end - loop.start) * zoom}px"
            onpointerdown={(e) => startDrag(e, { kind: 'loop-move', origin: loop.start, length: loop.end - loop.start })}
            role="slider"
            aria-label="Loop region"
            aria-valuenow={loop.start}
            tabindex="-1"
          >
            <span class="absolute inset-y-0 -left-1.5 w-3 cursor-ew-resize" onpointerdown={(e) => startDrag(e, { kind: 'loop-start', origin: loop.start, length: loop.end - loop.start })} role="presentation"></span>
            <span class="absolute inset-y-0 -right-1.5 w-3 cursor-ew-resize" onpointerdown={(e) => startDrag(e, { kind: 'loop-end', origin: loop.start, length: loop.end - loop.start })} role="presentation"></span>
          </div>
        {/if}
      </div>
    </div>

    {#each project.tracks as track, index (track.id)}
      {@const selected = studio.track?.id === track.id}
      {@const color = trackColor(index)}
      <div class="flex border-b border-line" style:height="{ROW}px">
        <div
          class={['sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line pr-1.5 pl-2', selected ? 'bg-raised' : 'bg-surface']}
          style:width="{header}px"
          style:box-shadow="inset 3px 0 0 {color}"
        >
          <button type="button" class="min-w-0 flex-1 cursor-pointer truncate text-left" onclick={() => studio.select(track.id)} aria-pressed={selected}>
            {#if selected && studio.recording}<span class="mr-1 inline-block size-2 animate-pulse rounded-full bg-danger"></span>{/if}{track.name}
          </button>
          <button
            type="button"
            class={['size-6 shrink-0 cursor-pointer rounded text-[11px] font-bold', track.muted ? 'bg-danger/30 text-fg' : 'text-muted hover:bg-hover']}
            onclick={() => studio.edit(() => (track.muted = !track.muted))}
            aria-pressed={track.muted}
            title="Mute">M</button
          >
          <button
            type="button"
            class={['size-6 shrink-0 cursor-pointer rounded text-[11px] font-bold', track.solo ? 'bg-accent text-bg' : 'text-muted hover:bg-hover']}
            onclick={() => studio.edit(() => (track.solo = !track.solo))}
            aria-pressed={track.solo}
            title="Solo">S</button
          >
        </div>
        <div
          class="relative"
          style:width="{width}px"
          style:background-image="repeating-linear-gradient(90deg, var(--color-line) 0 1px, transparent 1px {bar * zoom}px)"
          onclick={(e) => onLaneClick(e, track)}
          role="presentation"
        >
          {#each track.clips as clip (clip.id)}
            {@const active = studio.clip?.id === clip.id}
            <div
              class={['absolute inset-y-1 cursor-grab touch-none overflow-hidden rounded-md', active ? 'ring-2 ring-fg' : '']}
              style:left="{clip.start * zoom}px"
              style:width="{clip.length * zoom}px"
              style:background="color-mix(in srgb, {color} 18%, var(--color-display))"
              style:border="1px solid {color}"
              onpointerdown={(e) => onClipDown(e, track, clip)}
              onclick={(e) => e.stopPropagation()}
              onkeydown={(e) => e.key === 'Enter' && studio.select(track.id, clip.id)}
              data-arrangement-clip role="button"
              tabindex="0"
              aria-label="Clip at bar {Math.floor(clip.start / bar) + 1}"
            >
              <ClipPreview {clip} {color} {zoom} />
              <span class="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize"></span>
            </div>
          {/each}
        </div>
      </div>
    {/each}

    <p class="sticky left-0 p-3 text-xs text-muted" style:width="min(100vw, 520px)">
      Tap a track's lane again to add a clip · drag clips to move, their right edge to resize · ⌘ + scroll to zoom
    </p>

    <div class="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-accent" style:left="{header + studio.position * zoom}px"></div>
  </div>
</div>
