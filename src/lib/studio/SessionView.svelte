<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity'
  import { symbol } from '../input/keymaps'
  import Icon from '../ui/Icon.svelte'
  import { layout } from '../ui/layout.svelte'
  import { trackColor } from './Arrangement.svelte'
  import { controls, type Target } from './controls.svelte'
  import type { Clip, Track } from './project'
  import { LAUNCH_KEYS, STOP, studio } from './studio.svelte'
  import { STUDIO_PANELS } from './panels'

  const compact = new MediaQuery('(max-width: 639px)')
  const HOLD_MS = 450
  const keyFor = new Map([...LAUNCH_KEYS].map(([code, cell]) => [`${cell.track}:${cell.scene}`, code]))

  const project = $derived(studio.project)
  const column = $derived(compact.current ? 92 : 124)

  let holding = 0
  let held = false

  /** Long press (or right click) opens a clip for editing instead of launching it. */
  function edit(track: Track, scene: number) {
    studio.selectSlot(track.id, scene)
    layout.show(STUDIO_PANELS, 'steps')
  }

  function press(e: PointerEvent, track: Track, scene: number) {
    if (e.button === 2 || controls.learning) return
    held = false
    clearTimeout(holding)
    holding = window.setTimeout(() => {
      held = true
      edit(track, scene)
    }, HOLD_MS)
  }

  function release(track: Track, scene: number, clip: Clip | null) {
    clearTimeout(holding)
    if (held) return
    if (controls.learning) return controls.arm({ kind: 'slot', track: project.tracks.indexOf(track), scene })
    studio.selectSlot(track.id, scene)
    studio.launch(track, clip)
  }

  function target(t: Target, run: () => void) {
    if (controls.learning) controls.arm(t)
    else run()
  }

  const progress = (clip: Clip, origin: number) => (((studio.beat - origin) % clip.length) + clip.length) % clip.length / clip.length
</script>

{#snippet badge(t: Target)}
  {@const label = controls.learning ? controls.label(t) : null}
  {#if label}<span class="absolute top-0.5 right-1 rounded bg-accent px-1 text-[9px] font-bold text-bg">{label}</span>{/if}
{/snippet}

<div class="relative min-h-0 overflow-auto overscroll-contain bg-bg" role="grid" aria-label="Session">
  <div
    class="grid w-fit"
    style:grid-template-columns="repeat({project.tracks.length}, {column}px) {compact.current ? 76 : 112}px"
    style:grid-template-rows="auto repeat({project.scenes.length}, {compact.current ? 52 : 44}px) auto"
  >
    {#each project.tracks as track, index (track.id)}
      {@const selected = studio.track?.id === track.id}
      <button
        type="button"
        class={['sticky top-0 z-10 flex h-10 cursor-pointer items-center gap-1.5 truncate border-r border-b border-line px-2 text-left text-sm', selected ? 'bg-raised' : 'bg-surface']}
        style:box-shadow="inset 0 3px 0 {trackColor(index)}"
        onclick={() => target({ kind: 'volume', track: index }, () => studio.select(track.id))}
        aria-pressed={selected}
      >
        {#if selected && studio.recording}<span class="size-2 shrink-0 animate-pulse rounded-full bg-danger"></span>{/if}
        <span class="truncate">{track.name}</span>
        {@render badge({ kind: 'volume', track: index })}
      </button>
    {/each}
    <div class="sticky top-0 right-0 z-20 flex h-10 items-center justify-center border-b border-line bg-surface text-xs text-muted">Scenes</div>

    {#each project.scenes as scene, s (scene.id)}
      {#each project.tracks as track, index (track.id)}
        {@const clip = track.slots[s]}
        {@const lane = studio.lanes[index]}
        {@const active = !!clip && lane?.active === clip.id}
        {@const queued = !!clip && lane?.queued === clip.id}
        {@const chosen = studio.track?.id === track.id && studio.selectedScene === s}
        {@const color = trackColor(index)}
        {@const key = studio.launchMode ? keyFor.get(`${index}:${s}`) : undefined}
        {@const armed = controls.isArmed({ kind: 'slot', track: index, scene: s })}
        <button
          type="button"
          class={[
            'relative m-0.5 cursor-pointer touch-none overflow-hidden rounded-md text-left text-xs select-none',
            clip ? 'text-fg' : 'border border-dashed border-line text-muted hover:bg-raised',
            chosen && 'ring-2 ring-fg/70',
            queued && 'animate-pulse',
            armed && 'ring-2 ring-accent',
          ]}
          style:background={clip ? `${color}${active ? '66' : '2e'}` : undefined}
          style:border={clip ? `1px solid ${color}` : undefined}
          onpointerdown={(e) => press(e, track, s)}
          onpointerup={() => release(track, s, clip)}
          onpointerleave={() => clearTimeout(holding)}
          oncontextmenu={(e) => {
            e.preventDefault()
            edit(track, s)
          }}
          aria-label={clip ? `Launch clip on ${track.name}, scene ${scene.name}` : `Stop ${track.name}`}
          aria-pressed={active}
        >
          {#if clip}
            <span class="absolute inset-y-0 left-1.5 flex items-center">
              <Icon name={active ? 'stop' : 'play'} filled class="size-3" />
            </span>
            <span class="absolute inset-y-0 right-1.5 left-6 flex items-center truncate">{Math.round((clip.length / project.beatsPerBar) * 10) / 10} bar · {clip.notes.length}</span>
            {#if active && lane}
              <span class="absolute bottom-0 left-0 h-0.5 bg-fg" style:width="{progress(clip, lane.origin) * 100}%"></span>
            {/if}
          {:else if chosen}
            <span class="absolute inset-0 flex items-center justify-center">
              <span
                class="flex size-7 items-center justify-center rounded-md bg-raised hover:bg-hover"
                role="button"
                tabindex="-1"
                aria-label="New clip"
                onpointerdown={(e) => e.stopPropagation()}
                onpointerup={(e) => {
                  e.stopPropagation()
                  studio.addSlotClip(track, s)
                }}><Icon name="plus" class="size-4" /></span
              >
            </span>
          {/if}
          {#if key}<span class="absolute top-0.5 right-1 text-[10px] font-semibold text-muted">{symbol(key)}</span>{/if}
          {@render badge({ kind: 'slot', track: index, scene: s })}
        </button>
      {/each}
      <button
        type="button"
        class={['sticky right-0 z-10 m-0.5 flex cursor-pointer items-center gap-1.5 rounded-md bg-surface px-2 text-sm hover:bg-raised', studio.selectedScene === s && 'text-accent', controls.isArmed({ kind: 'scene', scene: s }) && 'ring-2 ring-accent']}
        onclick={() => target({ kind: 'scene', scene: s }, () => studio.launchScene(s))}
        aria-label="Launch scene {scene.name}"
      >
        <Icon name="play" filled class="size-3" />{scene.name}
        {@render badge({ kind: 'scene', scene: s })}
      </button>
    {/each}

    {#each project.tracks as track, index (track.id)}
      {@const stopping = studio.lanes[index]?.queued === STOP}
      <button
        type="button"
        class={['sticky bottom-0 z-10 m-0.5 flex h-9 cursor-pointer items-center justify-center rounded-md bg-surface text-muted hover:bg-raised hover:text-fg', stopping && 'animate-pulse text-fg', controls.isArmed({ kind: 'stop', track: index }) && 'ring-2 ring-accent']}
        onclick={() => target({ kind: 'stop', track: index }, () => studio.launch(track, null))}
        aria-label="Stop {track.name}"
        title="Stop track"
      >
        <Icon name="stop" filled class="size-3.5" />
        {@render badge({ kind: 'stop', track: index })}
      </button>
    {/each}
    <div class="sticky right-0 bottom-0 z-20 m-0.5 flex gap-1">
      <button
        type="button"
        class={['flex h-9 flex-1 cursor-pointer items-center justify-center gap-1 rounded-md bg-surface text-xs hover:bg-raised', controls.isArmed({ kind: 'stop-all' }) && 'ring-2 ring-accent']}
        onclick={() => target({ kind: 'stop-all' }, () => studio.stopAll())}
        title="Stop all clips (Esc in launch mode)"
      >
        <Icon name="stop" filled class="size-3.5" />All
        {@render badge({ kind: 'stop-all' })}
      </button>
      <button type="button" class="flex size-9 cursor-pointer items-center justify-center rounded-md bg-surface hover:bg-raised" onclick={() => studio.addScene()} title="Add scene" aria-label="Add scene">
        <Icon name="plus" class="size-4" />
      </button>
    </div>
  </div>

  {#if controls.learning}
    <p class="sticky bottom-12 left-0 m-2 w-fit rounded-lg bg-accent px-3 py-2 text-sm text-bg">
      {controls.armed ? 'Now press a pad, key or knob on your controller' : 'Tap a clip, scene, stop button or track name (volume), then move a control'}
    </p>
  {/if}
</div>
