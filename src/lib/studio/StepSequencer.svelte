<script lang="ts">
  import { preserveScroll, restoreScroll } from '../ui/adaptive'
  import { MediaQuery } from 'svelte/reactivity'
  import { engine } from '../audio/engine.svelte'
  import { noteName } from '../input/keymaps'
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import Segmented from '../ui/Segmented.svelte'
  import Select, { type Option } from '../ui/Select.svelte'
  import Toolbar, { type ToolItem } from '../ui/Toolbar.svelte'
  import { live, SCALES } from './live.svelte'
  import type { Clip, ClipNote, Track } from './project'
  import { isKit, studio, trackChannel } from './studio.svelte'

  let { track, clip, color }: { track: Track; clip: Clip; color: string } = $props()

  const coarse = new MediaQuery('(pointer: coarse)')
  const LABEL = 76
  const AUDITION_MS = 180
  const EPSILON = 1e-6
  const VELOCITY_LEVELS = [1, 0.7, 0.4]
  const RESOLUTIONS: Option[] = [
    { value: String(1 / 2), label: '1/8' },
    { value: String(1 / 4), label: '1/16' },
    { value: String(1 / 6), label: '1/16 triplet' },
    { value: String(1 / 8), label: '1/32' },
  ]
  type Tool = 'draw' | 'velocity'
  const TOOLS: Tool[] = ['draw', 'velocity']

  let resolution = $state(1 / 4)
  let tool = $state<Tool>('draw')
  let base = $state(48)
  let width = $state(0)
  let scroller: HTMLDivElement

  const kit = $derived(isKit(track))
  const steps = $derived(Math.max(1, Math.round(clip.length / resolution)))
  const stepsPerBeat = $derived(Math.round(1 / resolution))
  const stepWidth = $derived(Math.max(coarse.current ? 30 : 22, Math.min(48, (width - LABEL) / steps)))
  const rowHeight = $derived(coarse.current ? 34 : 26)
  /** Kit tracks: one row per pad, kick first as on drum machines. Melodic tracks: two octaves of the live scale from `base`, highest first. */
  const rows = $derived.by(() => {
    if (kit) return [...track.pads].sort((a, b) => a.midi - b.midi).map((pad) => ({ pitch: pad.midi, label: pad.name }))
    const degrees = SCALES[live.settings.scale]
    const result: { pitch: number; label: string }[] = []
    for (let pitch = Math.min(127, base + 24); pitch >= base; pitch--) {
      if (degrees.includes(((((pitch - live.settings.root) % 12) + 12) % 12) as never)) result.push({ pitch, label: noteName(pitch) })
    }
    return result
  })
  const channel = $derived(trackChannel(studio.project.tracks.indexOf(track)))
  const stepping = $derived(studio.stepInput?.clip === clip.id ? studio.stepInput : null)
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

  $effect(() => {
    void clip.id
    if (kit || !clip.notes.length) return
    const lowest = Math.min(...clip.notes.map((n) => n.pitch))
    base = Math.max(0, Math.min(103, lowest - (lowest % 12)))
  })

  /** Melodic rows start at `base` at the bottom, where the clip's notes are; open there. */
  $effect(() => {
    void [clip.id, base]
    if (!kit) queueMicrotask(() => scroller && !restoreScroll(scroller,`steps:${clip.id}:${base}`) && (scroller.scrollTop = scroller.scrollHeight))
  })

  $effect(() => {
    const input = studio.stepInput
    if (input?.clip === clip.id && input.resolution !== resolution) {
      input.cursor = Math.round((input.cursor * input.resolution) / resolution) % steps
      input.resolution = resolution
    }
  })

  function audition(pitch: number, velocity = 0.8) {
    const voice = engine.noteOn(pitch, velocity, channel)
    setTimeout(() => voice.stop(), AUDITION_MS)
  }

  const noteAt = (pitch: number, step: number) =>
    clip.notes.find((n) => n.pitch === pitch && n.start <= step * resolution + EPSILON && n.start + n.length > step * resolution + EPSILON)

  function onRowDown(e: PointerEvent, pitch: number) {
    const element = e.currentTarget as HTMLElement
    const step = Math.floor((e.clientX - element.getBoundingClientRect().left) / stepWidth)
    if (step < 0 || step >= steps) return
    const existing = noteAt(pitch, step)
    if (existing) {
      if (tool === 'velocity') {
        const next = VELOCITY_LEVELS[(VELOCITY_LEVELS.findIndex((v) => Math.abs(v - existing.velocity) < 0.05) + 1) % VELOCITY_LEVELS.length]
        studio.edit(() => (existing.velocity = next))
        audition(pitch, next)
      } else {
        studio.edit(() => (clip.notes = clip.notes.filter((n) => n !== existing)))
      }
      return
    }
    if (tool !== 'draw') return
    studio.edit(() => clip.notes.push({ pitch, start: step * resolution, length: resolution, velocity: VELOCITY_LEVELS[0] }))
    const note = clip.notes.at(-1)!
    audition(pitch)
    element.setPointerCapture(e.pointerId)
    const left = element.getBoundingClientRect().left
    const move = (event: PointerEvent) => {
      const last = Math.max(step, Math.min(steps - 1, Math.floor((event.clientX - left) / stepWidth)))
      note.length = (last - step + 1) * resolution
    }
    const up = () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
  }

  function rotate(direction: 1 | -1) {
    studio.edit(() => {
      for (const note of clip.notes) note.start = (((note.start + direction * resolution) % clip.length) + clip.length) % clip.length
    })
  }

  function double() {
    studio.edit(() => {
      const copies: ClipNote[] = clip.notes.map((n) => ({ ...n, start: n.start + clip.length }))
      if (clip.repeat >= clip.length) clip.repeat = clip.length * 2
      clip.length *= 2
      clip.notes.push(...copies)
    })
  }

  function toggleStepInput() {
    studio.stepInput = stepping ? null : { clip: clip.id, cursor: 0, resolution }
    if (studio.stepInput) {
      const keyboard = document.querySelector<HTMLElement>('[data-performance-surface]')
      if (keyboard?.getClientRects().length) keyboard.focus({preventScroll:true})
      else (document.activeElement as HTMLElement)?.blur()
    }
  }

  const items: ToolItem[] = $derived([
    { id: 'resolution', label: 'Step length', priority: 8, content: resolutionSelect, menu: resolutionSelect },
    { id: 'tool', label: 'Tool', priority: 7, content: toolSwitch, menu: toolSwitch },
    { id: 'step-input', label: 'Step input: play notes to fill steps one by one', icon: 'record', priority: 9, active: !!stepping, onclick: toggleStepInput },
    { id: 'step-back', label: 'Step back', icon: 'undo', priority: 5, disabled: !stepping, onclick: () => studio.stepMove(-1) },
    { id: 'step-rest', label: 'Rest (skip a step)', text: 'Rest', priority: 5, disabled: !stepping, onclick: () => studio.stepMove(1) },
    ...(kit
      ? []
      : [
          { id: 'down', label: 'Show lower octave', icon: 'minus' as const, priority: 6, onclick: () => (base = Math.max(0, base - 12)) },
          { id: 'up', label: 'Show higher octave', icon: 'plus' as const, priority: 6, onclick: () => (base = Math.min(103, base + 12)) },
        ]),
    { id: 'gap', spacer: true },
    { id: 'left', label: 'Shift pattern left', text: '◀', priority: 3, onclick: () => rotate(-1) },
    { id: 'right', label: 'Shift pattern right', text: '▶', priority: 3, onclick: () => rotate(1) },
    { id: 'double', label: 'Double the clip and its notes', text: '×2', priority: 4, onclick: double },
    { id: 'clear', label: 'Clear all notes', icon: 'trash', priority: 2, disabled: !clip.notes.length, onclick: () => studio.edit(() => (clip.notes = [])) },
  ])
</script>

{#snippet resolutionSelect()}
  <div class="w-32"><Select bind:value={() => String(resolution), (v) => (resolution = Number(v))} options={RESOLUTIONS} /></div>
{/snippet}

{#snippet toolSwitch()}
  <Segmented label="Tool" value={tool} options={TOOLS} onselect={(next) => (tool = next)} />
{/snippet}

<div class="grid min-w-0 grid-cols-[minmax(0,1fr)] h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
  <div class="flex border-b border-line px-2 py-1">
    <Toolbar label="Steps" {items} />
  </div>
  <div bind:this={scroller} use:preserveScroll={`steps:${clip.id}:${base}`} class="min-h-0 overflow-auto overscroll-contain" bind:clientWidth={width} role="grid" aria-label="Step grid">
    <div class="relative" style:width="{LABEL + steps * stepWidth}px">
      {#each rows as { pitch, label } (pitch)}
        {@const accent = !kit && pitch % 12 === live.settings.root}
        <div class="flex border-b border-black/30" style:height="{rowHeight}px">
          <button
            type="button"
            class={['sticky left-0 z-10 shrink-0 cursor-pointer truncate bg-surface px-2 text-left text-xs', accent ? 'text-accent' : 'text-muted']}
            style:width="{LABEL}px"
            onpointerdown={() => audition(pitch)}
            tabindex="-1">{label}</button
          >
          <div
            class="relative touch-none"
            style:width="{steps * stepWidth}px"
            style:background-image="repeating-linear-gradient(90deg, var(--color-grid-strong) 0 1px, transparent 1px {stepWidth * stepsPerBeat * studio.project.beatsPerBar}px), repeating-linear-gradient(90deg, var(--color-grid) 0 1px, transparent 1px {stepWidth * stepsPerBeat}px), repeating-linear-gradient(90deg, var(--color-grid-faint) 0 1px, transparent 1px {stepWidth}px)"
            onpointerdown={(e) => onRowDown(e, pitch)}
            role="row"
            tabindex="-1"
            aria-label="{label} steps"
          >
            {#each clip.notes as note, i (i)}
              {#if note.pitch === pitch}
                <span
                  class="pointer-events-none absolute inset-y-1 rounded-[4px]"
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
      {#if playStep >= 0}
        <div class="pointer-events-none absolute inset-y-0 bg-fg/10" style:left="{LABEL + playStep * stepWidth}px" style:width="{stepWidth}px"></div>
      {/if}
      {#if stepping}
        <div class="pointer-events-none absolute inset-y-0 border-2 border-danger/80" style:left="{LABEL + stepping.cursor * stepWidth}px" style:width="{stepWidth}px"></div>
      {/if}
    </div>
  </div>
</div>
