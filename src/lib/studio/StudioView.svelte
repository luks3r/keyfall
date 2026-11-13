<script lang="ts">
  import { inputFocus } from '../input/focus.svelte'
  import type { Player } from '../player.svelte'
  import Panel from '../ui/Panel.svelte'
  import Button from '../ui/Button.svelte'
  import Dock from '../ui/Dock.svelte'
  import { layout, type PanelSpec } from '../ui/layout.svelte'
  import Split from '../ui/Split.svelte'
  import Arrangement, { trackColor } from './Arrangement.svelte'
  import { AREA, KEYBOARD_PANEL, STUDIO_PANELS } from './panels'
  import KeysPanel from './KeysPanel.svelte'
  import PadsPanel from './PadsPanel.svelte'
  import ClipActions from './ClipActions.svelte'
  import StepSequencer from './StepSequencer.svelte'
  import PianoRoll from './PianoRoll.svelte'
  import SessionView from './SessionView.svelte'
  import TrackPanel from './TrackPanel.svelte'
  import { studio, trackChannel } from './studio.svelte'

  let { player, onpractice }: { player: Player; onpractice: (trackIds: string[]) => void } = $props()

  const narrow = $derived(layout.narrow.current)
  const focused = $derived(layout.focused.current)
  let performance = $state('keyboard')
  const panels = $derived(narrow ? [KEYBOARD_PANEL, ...STUDIO_PANELS] : STUDIO_PANELS)
  const index = $derived(studio.project.tracks.findIndex((t) => t.id === studio.track?.id))
  const sideOpen = $derived(layout.isOpen(AREA.side) && layout.panelsIn(panels, 'side').length > 0)
  const bottomOpen = $derived(layout.isOpen(AREA.bottom) && layout.panelsIn(panels, 'bottom').length > 0)


  $effect(() => {
    studio.attach(player)
    return () => studio.detach()
  })

  function onKey(e: KeyboardEvent) {
    if (e.defaultPrevented || inputFocus.blocked || !(e.metaKey || e.ctrlKey) || e.code !== 'KeyZ' || (e.target instanceof HTMLElement && !!e.target.closest('input,textarea,select,[contenteditable="true"]'))) return
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
        <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]"><ClipActions track={studio.track} clip={studio.clip} onedit={(editor) => studio.openClipEditor(studio.track!.id, studio.clip!.id, editor)} /><StepSequencer track={studio.track} clip={studio.clip} color={trackColor(index)} /></div>
      {:else}
        <p class="p-4 text-muted">Select a clip to sequence it, or create one in the Session grid.</p>
      {/if}
    {:else if spec.id === 'notes'}
      {#if studio.clip && studio.track}
        <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]"><ClipActions track={studio.track} clip={studio.clip} onedit={(editor) => studio.openClipEditor(studio.track!.id, studio.clip!.id, editor)} /><PianoRoll track={studio.track} clip={studio.clip} channel={trackChannel(index)} color={trackColor(index)} /></div>
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

{#if focused}
  <section class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]" aria-label="Studio focused workspace">
    <nav class="flex items-center gap-1 border-b border-line bg-surface px-2 py-1" aria-label="Studio surfaces">
      {#each [{id:'project',label:'Project'},{id:'editor',label:'Edit'},{id:'performance',label:'Play'}] as item}
        <Button aria-pressed={layout.surface===item.id} onclick={()=>layout.surface=item.id as typeof layout.surface}>{item.label}</Button>
      {/each}
      <span class="flex-1"></span>
      <Button onclick={()=>layout.inspectorOpen=true} aria-label="Track sound controls">Sound</Button>
    </nav>
    <div class="grid min-h-0" style:display={layout.surface==='project'?'grid':'none'}>{@render arrangement()}</div>
    <div class="grid min-h-0" style:display={layout.surface==='editor'?'grid':'none'}>
      {@render panel({id:studio.clipEditor,title:'Clip editor',zone:'bottom'})}
    </div>
    <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]" style:display={layout.surface==='performance'?'grid':'none'}>
      <div class="flex items-center gap-2 border-b border-line px-2 py-1">
        <Button aria-pressed={performance==='keyboard'} onclick={()=>performance='keyboard'}>Keyboard</Button>
        <Button aria-pressed={performance==='pads'} onclick={()=>performance='pads'}>Pads</Button>
      </div>
      <div class="grid min-h-0" style:display={performance==='keyboard'?'grid':'none'}>{@render keyboard()}</div>
      {#if performance==='pads' && studio.track}<PadsPanel {player} track={studio.track} color={trackColor(index)} />{/if}
    </div>
  </section>
  {#if layout.inspectorOpen && studio.track}
    <Panel title={studio.track.name + ' · sound'} width={400} onclose={()=>layout.inspectorOpen=false}><TrackPanel track={studio.track} {onpractice} /></Panel>
  {/if}
{:else}
  <Split id={AREA.keys} direction="column" size={200} min={130} minStart={260} open={layout.isOpen(AREA.keys)} start={withBottom} end={keyboard} />
{/if}
