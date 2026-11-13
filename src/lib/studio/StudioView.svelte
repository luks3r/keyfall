<script lang="ts">
  import type { Player } from '../player.svelte'
  import Dock from '../ui/Dock.svelte'
  import { layout, type PanelSpec } from '../ui/layout.svelte'
  import Split from '../ui/Split.svelte'
  import Arrangement, { trackColor } from './Arrangement.svelte'
  import { AREA, KEYBOARD_PANEL, STUDIO_PANELS } from './panels'
  import KeysPanel from './KeysPanel.svelte'
  import PadsPanel from './PadsPanel.svelte'
  import StepSequencer from './StepSequencer.svelte'
  import PianoRoll from './PianoRoll.svelte'
  import SessionView from './SessionView.svelte'
  import TrackPanel from './TrackPanel.svelte'
  import { studio, trackChannel } from './studio.svelte'

  let { player, onpractice }: { player: Player; onpractice: (trackIds: string[]) => void } = $props()

  const narrow = $derived(layout.narrow.current)
  const panels = $derived(narrow ? [KEYBOARD_PANEL, ...STUDIO_PANELS] : STUDIO_PANELS)
  const index = $derived(studio.project.tracks.findIndex((t) => t.id === studio.track?.id))
  const sideOpen = $derived(layout.isOpen(AREA.side) && layout.panelsIn(panels, 'side').length > 0)
  const bottomOpen = $derived(layout.isOpen(AREA.bottom) && layout.panelsIn(panels, 'bottom').length > 0)

  $effect(() => {
    if (studio.view === 'arrange' && studio.clip) layout.show(panels, 'notes')
  })

  $effect(() => {
    studio.attach(player)
    return () => studio.detach()
  })

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || e.code !== 'KeyZ' || e.target instanceof HTMLInputElement) return
    e.preventDefault()
    if (e.shiftKey) studio.redo()
    else studio.undo()
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet panel(spec: PanelSpec)}
  <div class="@container grid min-h-0 min-w-0">
    {#if spec.id === 'keyboard'}
      <KeysPanel {player} />
    {:else if spec.id === 'steps'}
      {#if studio.clip && studio.track}
        <StepSequencer track={studio.track} clip={studio.clip} color={trackColor(index)} />
      {:else}
        <p class="p-4 text-muted">Select a clip to sequence it, or create one in the Session grid.</p>
      {/if}
    {:else if spec.id === 'notes'}
      {#if studio.clip && studio.track}
        <PianoRoll track={studio.track} clip={studio.clip} channel={trackChannel(index)} color={trackColor(index)} />
      {:else}
        <p class="p-4 text-muted">Select a clip to edit its notes, or tap a selected track's lane to add one.</p>
      {/if}
    {:else if spec.id === 'pads' && studio.track}
      <PadsPanel {player} track={studio.track} color={trackColor(index)} />
    {:else if spec.id === 'track' && studio.track}
      <TrackPanel track={studio.track} {onpractice} />
    {/if}
  </div>
{/snippet}

{#snippet bottomDock()}
  <div class="grid min-h-0 border-t border-line">
    <Dock zone="bottom" {panels} {panel} onclose={narrow ? undefined : () => layout.setOpen(AREA.bottom, false)} />
  </div>
{/snippet}

{#snippet sideDock()}
  <div class="grid min-h-0 border-l border-line">
    <Dock zone="side" {panels} {panel} onclose={() => layout.setOpen(AREA.side, false)} />
  </div>
{/snippet}

{#snippet keyboard()}
  <div class="grid min-h-0 border-t border-line"><KeysPanel {player} /></div>
{/snippet}

{#snippet arrangement()}
  {#if studio.view === 'session'}<SessionView />{:else}<Arrangement />{/if}
{/snippet}

{#snippet withSide()}
  <Split id={AREA.side} size={320} min={240} minStart={280} open={sideOpen} start={arrangement} end={sideDock} />
{/snippet}

{#snippet withBottom()}
  <Split id={AREA.bottom} direction="column" size={280} min={140} minStart={140} open={bottomOpen} start={withSide} end={bottomDock} />
{/snippet}

{#if narrow}
  <Split id={AREA.narrow} direction="column" size={360} min={160} minStart={140} start={arrangement} end={bottomDock} />
{:else}
  <Split id={AREA.keys} direction="column" size={200} min={130} minStart={260} open={layout.isOpen(AREA.keys)} start={withBottom} end={keyboard} />
{/if}
