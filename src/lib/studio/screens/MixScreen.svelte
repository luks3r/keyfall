<script lang="ts">
  import { knobs, percentKnob, type KnobSpec } from '../../device/knobs.svelte'
  import { trackColor } from '../Arrangement.svelte'
  import type { Track } from '../project'
  import { studio } from '../studio.svelte'

  /** The bank's four channels: levels on the four knobs, mute and solo by tapping. */
  let { bank }: { bank: Track[] } = $props()
  const TRACK_LEVEL = 0.8

  const specs = $derived<(KnobSpec | null)[]>(
    [0, 1, 2, 3].map((i) => {
      const track = bank[i]
      return track ? percentKnob(track.name, () => track.volume, (v) => studio.tweak(() => (track.volume = v)), TRACK_LEVEL) : null
    }),
  )

  $effect(() => knobs.use(specs))

  /** The level bar is a fader too: press sets the level where you press, drag follows. */
  function fader(e: PointerEvent, track: Track) {
    if (e.button !== 0) return
    const element = e.currentTarget as HTMLElement
    element.setPointerCapture(e.pointerId)
    const set = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect()
      const level = Math.max(0, Math.min(1, (rect.bottom - event.clientY) / rect.height))
      studio.tweak(() => (track.volume = Math.round(level * 100) / 100))
    }
    set(e)
    const up = () => {
      element.removeEventListener('pointermove', set)
      element.removeEventListener('pointerup', up)
    }
    element.addEventListener('pointermove', set)
    element.addEventListener('pointerup', up)
  }
</script>

<div class="grid min-h-0 grid-cols-4 gap-2 p-3">
  {#each bank as track (track.id)}
    {@const index = studio.project.tracks.indexOf(track)}
    {@const playing = !!studio.lanes[index]?.active}
    <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2">
      <button type="button" class={['truncate rounded px-1 py-1 text-left font-mono text-[11px] uppercase', studio.track?.id === track.id ? 'bg-fg text-bg' : 'text-muted']} onclick={() => studio.select(track.id)}>
        {track.name}
      </button>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="relative min-h-0 cursor-ns-resize touch-none overflow-hidden rounded-md bg-raised" aria-label="{track.name} level {Math.round(track.volume * 100)}%" title="Drag to set the level · double-click resets" onpointerdown={(e) => fader(e, track)} ondblclick={() => studio.edit(() => (track.volume = TRACK_LEVEL))}>
        <div class={['absolute inset-x-0 bottom-0 transition-[height]', !playing && 'opacity-60']} style:height="{track.volume * 100}%" style:background={trackColor(index)}></div>
      </div>
      <div class="grid grid-cols-2 gap-1">
        <button type="button" class={['h-8 rounded font-mono text-xs', track.muted ? 'bg-danger text-bg' : 'bg-raised']} aria-pressed={track.muted} aria-label="Mute {track.name}" title="Mute" onclick={() => studio.edit(() => (track.muted = !track.muted))}>M</button>
        <button type="button" class={['h-8 rounded font-mono text-xs', track.solo ? 'bg-fg text-bg' : 'bg-raised']} aria-pressed={track.solo} aria-label="Solo {track.name}" title="Solo: hear only soloed tracks" onclick={() => studio.edit(() => (track.solo = !track.solo))}>S</button>
      </div>
    </div>
  {/each}
</div>
