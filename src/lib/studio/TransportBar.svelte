<script lang="ts">
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import { layout } from '../ui/layout.svelte'
  import { type ToolItem } from '../ui/Toolbar.svelte'
  import Toolbars from '../ui/Toolbars.svelte'
  import WorkspaceSwitch from '../WorkspaceSwitch.svelte'
  import { AREA } from './panels'
  import { DRUMS } from '../audio/drums'
  import { BUILTIN } from '../audio/samples'
  import Segmented from '../ui/Segmented.svelte'
  import Select, { type Option } from '../ui/Select.svelte'
  import { controls } from './controls.svelte'
  import { KIT } from './project'
  import { MAX_TRACKS, studio, type View } from './studio.svelte'

  let { onimport, onexport, onpractice, onsettings }: { onimport: (file: File) => void; onexport: () => void; onpractice: () => void; onsettings: () => void } =
    $props()

  let fileInput: HTMLInputElement

  const project = $derived(studio.project)
  const bar = $derived(Math.floor(studio.position / project.beatsPerBar) + 1)
  const beat = $derived(Math.floor(studio.position % project.beatsPerBar) + 1)
  const wide = $derived(!layout.narrow.current)
  const TRANSPORT = new Set(['view', 'start', 'play', 'record', 'position', 'tempo', 'quantize', 'metronome', 'count-in', 'loop', 'gap-2'])
  const VIEWS: View[] = ['session', 'arrange']
  const QUANTIZE: Option[] = [
    { value: '0', label: 'Launch now' },
    { value: '1', label: 'Launch on beat' },
    { value: '2', label: 'Launch on ½ bar' },
    { value: '4', label: 'Launch on bar' },
    { value: '8', label: 'Launch on 2 bars' },
  ]
  const LOOP_BARS: Option[] = [1, 2, 4, 8].map((bars) => ({ value: String(bars), label: `${bars} bar loop` }))
  const drumPads = () => DRUMS.map((drum) => ({ midi: drum.midi, name: drum.name, sample: BUILTIN + drum.id })).sort((a, b) => a.midi - b.midi)
  const area = (id: string, label: string, icon: 'panel-side' | 'panel-bottom' | 'keyboard', priority: number): ToolItem => ({
    id,
    label,
    icon,
    priority,
    active: layout.isOpen(id),
    onclick: () => layout.setOpen(id, !layout.isOpen(id)),
  })

  const items: ToolItem[] = $derived([
    { id: 'workspace', label: 'Workspace', priority: Infinity, content: workspace },
    { id: 'name', label: 'Project name', priority: 1, content: name, menu: name },
    { id: 'view', label: 'View', priority: Infinity, content: view },
    { id: 'gap-1', spacer: true },
    { id: 'start', label: 'To start (Backspace)', icon: 'restart', priority: 9, onclick: () => studio.restart() },
    { id: 'play', label: 'Play', priority: Infinity, content: play },
    { id: 'record', label: 'Record', priority: Infinity, content: record },
    { id: 'position', label: 'Position', priority: Infinity, content: position },
    { id: 'tempo', label: 'Tempo', priority: 8, content: tempo, menu: tempoMenu },
    { id: 'quantize', label: 'Launch quantization', priority: 5, content: quantize, menu: quantize },
    { id: 'loop-bars', label: 'New loop length', priority: 2, content: loopBars, menu: loopBars },
    { id: 'metronome', label: 'Metronome', icon: 'metronome', priority: 6, active: studio.metronome, onclick: () => (studio.metronome = !studio.metronome) },
    { id: 'count-in', label: 'Count in one bar', text: '1 bar', priority: 4, active: studio.countIn, onclick: () => (studio.countIn = !studio.countIn) },
    { id: 'loop', label: 'Loop region', icon: 'loop', priority: 7, active: project.loop.enabled, onclick: () => studio.toggleLoop() },
    { id: 'gap-2', spacer: true },
    { id: 'undo', label: 'Undo (⌘Z)', icon: 'undo', priority: 5, disabled: !studio.history.undo, onclick: () => studio.undo() },
    { id: 'redo', label: 'Redo (⇧⌘Z)', icon: 'redo', priority: 4, disabled: !studio.history.redo, onclick: () => studio.redo() },
    { id: 'track', label: 'Add track', icon: 'plus', priority: 6, disabled: project.tracks.length >= MAX_TRACKS, onclick: () => studio.addTrack() },
    { id: 'drums', label: 'Add drum track', icon: 'pads', priority: 5, disabled: project.tracks.length >= MAX_TRACKS, onclick: () => studio.addTrack(KIT, drumPads()) },
    { id: 'launch-keys', label: 'Keys launch clips (Tab)', icon: 'grid', priority: 7, active: studio.launchMode, onclick: () => studio.toggleLaunchMode() },
    {
      id: 'learn',
      label: 'Map MIDI controller',
      icon: 'midi',
      priority: 3,
      active: controls.learning,
      onclick: () => ((controls.learning = !controls.learning), (controls.armed = null)),
    },
    { id: 'import', label: 'Import MIDI as a new project', icon: 'open', priority: 2, onclick: () => fileInput.click() },
    { id: 'export', label: 'Export as MIDI', icon: 'save', priority: 2, onclick: onexport },
    { id: 'practice', label: 'Practise all tracks in Learn', icon: 'learn', priority: 3, onclick: onpractice },
    ...(wide
      ? [area(AREA.side, 'Side panel', 'panel-side', 3), area(AREA.bottom, 'Bottom panel', 'panel-bottom', 3), area(AREA.keys, 'Keyboard', 'keyboard', 3)]
      : []),
    { id: 'settings', label: 'Settings', icon: 'settings', priority: Infinity, onclick: onsettings },
  ])
</script>

{#snippet view()}
  <Segmented label="View" value={studio.view} options={VIEWS} onselect={(next) => (studio.view = next)} />
{/snippet}

{#snippet quantize()}
  <div class="w-40"><Select bind:value={() => String(project.quantize), (v) => (project.quantize = Number(v))} options={QUANTIZE} /></div>
{/snippet}

{#snippet loopBars()}
  <div class="w-32"><Select bind:value={() => String(project.loopBars), (v) => (project.loopBars = Number(v))} options={LOOP_BARS} /></div>
{/snippet}

{#snippet workspace()}
  <span class="mr-1 size-3.5 shrink-0 rounded bg-gradient-to-br from-accent to-mint max-sm:hidden"></span>
  <WorkspaceSwitch />
{/snippet}

{#snippet name()}
  <input class="w-36 min-w-0 rounded-md bg-transparent px-1.5 py-1 font-semibold outline-none hover:bg-raised focus:bg-raised" bind:value={project.name} aria-label="Project name" />
{/snippet}

{#snippet play()}
  <Button variant="accent" shape="round" onclick={() => studio.toggle()} title="Play / Stop (Space)" aria-label={studio.playing ? 'Stop' : 'Play'}>
    <Icon name={studio.playing ? 'stop' : 'play'} filled />
  </Button>
{/snippet}

{#snippet record()}
  <Button
    variant={studio.recording ? 'danger' : 'ghost'}
    shape="square"
    onclick={() => studio.record()}
    title="Record on the selected track (Enter)"
    aria-label={studio.recording ? 'Stop recording' : 'Record'}
    aria-pressed={!!studio.recording}
  >
    <Icon name="record" filled class={['text-danger', studio.recording && 'animate-pulse']} />
  </Button>
{/snippet}

{#snippet position()}
  <span class="min-w-[5ch] text-center font-semibold tabular-nums" aria-label="Position">{bar}.{beat}</span>
{/snippet}

{#snippet tempoInput()}
  <input
    class="w-14 [appearance:textfield] rounded-md bg-raised px-1.5 py-1 text-center text-fg tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
    type="number"
    min="20"
    max="300"
    value={project.tempo}
    onchange={(e) => studio.setTempo(e.currentTarget.valueAsNumber || project.tempo)}
    aria-label="Tempo"
  />
{/snippet}

{#snippet tempo()}
  <label class="flex items-center gap-1 text-muted">{@render tempoInput()}<span class="max-lg:hidden">bpm</span></label>
{/snippet}

{#snippet tempoMenu()}
  <label class="flex items-center justify-between gap-3 px-1.5 text-muted">Tempo {@render tempoInput()}</label>
{/snippet}

<header
  data-tauri-drag-region
  class="flex items-center bg-surface pt-[max(env(safe-area-inset-top),0.5rem)] pr-[max(env(safe-area-inset-right),0.5rem)] pb-2 pl-[max(env(safe-area-inset-left),0.5rem)] sm:px-3 mac-native:pl-20"
>
  <Toolbars label="Studio" {items} second={TRANSPORT} />
  <input
    bind:this={fileInput}
    type="file"
    accept=".mid,.midi,audio/midi"
    hidden
    onchange={(e) => {
      const file = e.currentTarget.files?.[0]
      e.currentTarget.value = ''
      if (file) onimport(file)
    }}
  />
</header>
