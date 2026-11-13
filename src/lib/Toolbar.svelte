<script lang="ts">
  import { noteName } from './input/keymaps'
  import type { Room } from './net/room.svelte'
  import { MODES, type Player } from './player.svelte'
  import Button from './ui/Button.svelte'
  import Icon from './ui/Icon.svelte'
  import Segmented from './ui/Segmented.svelte'
  import { type ToolItem } from './ui/Toolbar.svelte'
  import Toolbars from './ui/Toolbars.svelte'
  import WorkspaceSwitch from './WorkspaceSwitch.svelte'

  let {
    player,
    onopen,
    onsave,
    onsettings,
    room,
    onroom,
    onstudio,
  }: {
    player: Player
    onopen: (file: File) => void
    onsave: () => void
    onsettings: () => void
    room: Room
    onroom: () => void
    onstudio: () => void
  } = $props()

  const CONTROLS = new Set(['mode', 'restart', 'play', 'speed', 'gap-2', 'octave', 'fit', 'pedal', 'accuracy'])

  let fileInput: HTMLInputElement

  const locked = $derived(!player.canControl)
  const connected = $derived(room.status === 'connected')
  const accuracy = $derived.by(() => {
    const total = player.hits + player.misses
    return total ? `${Math.round((100 * player.hits) / total)}%` : '—'
  })

  const items: ToolItem[] = $derived([
    { id: 'workspace', label: 'Workspace', priority: Infinity, content: workspace },
    { id: 'song', label: 'Song', priority: 1, content: song, menu: song },
    { id: 'gap-1', spacer: true },
    { id: 'mode', label: 'Mode', priority: 9, content: mode, menu: mode },
    { id: 'restart', label: 'Restart (Backspace)', icon: 'restart', priority: 8, disabled: locked, onclick: () => player.restart() },
    { id: 'play', label: 'Play', priority: Infinity, content: play },
    { id: 'speed', label: 'Speed', priority: 3, content: speed, menu: speed },
    { id: 'gap-2', spacer: true },
    { id: 'octave', label: 'Octave', priority: 7, content: octave, menu: octave },
    { id: 'fit', label: 'Fit keyboard to song', icon: 'fit', priority: 2, onclick: () => player.fit() },
    { id: 'pedal', label: 'Sustain (hold Shift, or tap)', text: 'Ped', priority: 6, active: player.sustain, onclick: () => player.setSustain(!player.sustain) },
    { id: 'accuracy', label: 'Accuracy', priority: 5, content: score, menu: score },
    { id: 'open', label: locked ? 'Only the host picks the song' : 'Open MIDI file', icon: 'open', priority: 4, disabled: locked, onclick: () => fileInput.click() },
    { id: 'studio', label: 'Open this song in Studio', icon: 'mixer', priority: 3, onclick: onstudio },
    { id: 'save', label: 'Export as MIDI', icon: 'save', priority: 2, onclick: onsave },
    { id: 'room', label: 'Multiplayer room', priority: Infinity, content: roomButton },
    { id: 'settings', label: 'Settings', icon: 'settings', priority: Infinity, onclick: onsettings },
  ])
</script>

{#snippet workspace()}
  <span class="mr-1 size-3.5 shrink-0 rounded-sm border border-fg bg-transparent max-sm:hidden"></span>
  <WorkspaceSwitch />
{/snippet}

{#snippet song()}
  <span class="max-w-56 truncate px-1.5 text-muted">{player.song.name}</span>
{/snippet}

{#snippet mode()}
  <Segmented label="Mode" value={player.mode} options={MODES} disabled={locked} onselect={(mode) => player.setMode(mode)} />
{/snippet}

{#snippet play()}
  <Button variant="accent" shape="round" onclick={() => player.toggle()} disabled={locked} title="Play / Pause (Space)" aria-label={player.playing ? 'Pause' : 'Play'}>
    <Icon name={player.playing ? 'pause' : 'play'} filled={!player.playing} />
  </Button>
{/snippet}

{#snippet speed()}
  <label class="flex items-center gap-2 px-1 text-muted tabular-nums" title="Speed">
    <input
      class="w-20"
      type="range"
      min="0.25"
      max="1.5"
      step="0.05"
      value={player.speed}
      disabled={locked}
      oninput={(e) => player.setSpeed(e.currentTarget.valueAsNumber)}
      aria-label="Speed"
    />
    <span class="w-[4ch]">{Math.round(player.speed * 100)}%</span>
  </label>
{/snippet}

{#snippet octave()}
  <div class="flex items-center" title="Octave (↑ ↓)">
    <Button variant="ghost" shape="square" onclick={() => player.shift(-12)} aria-label="Octave down"><Icon name="minus" /></Button>
    <span class="min-w-[4ch] shrink-0 text-center tabular-nums">{noteName(player.root)}</span>
    <Button variant="ghost" shape="square" onclick={() => player.shift(12)} aria-label="Octave up"><Icon name="plus" /></Button>
  </div>
{/snippet}

{#snippet score()}
  <span class="min-w-[5ch] shrink-0 px-1 text-center font-semibold text-mint tabular-nums" title="Accuracy">{accuracy}</span>
{/snippet}

{#snippet roomButton()}
  <Button variant={connected ? 'solid' : 'ghost'} shape={connected ? 'pill' : 'square'} onclick={onroom} title="Multiplayer room" aria-label="Multiplayer room">
    <Icon name="users" />
    {#if connected}<span class="tabular-nums">{room.peers.size + 1}</span>{/if}
  </Button>
{/snippet}

<header
  data-tauri-drag-region
  class="flex items-center bg-surface pt-[max(env(safe-area-inset-top),0.5rem)] pr-[max(env(safe-area-inset-right),0.5rem)] pb-2 pl-[max(env(safe-area-inset-left),0.5rem)] sm:px-3 lg:min-h-15 mac-native:pl-20"
>
  <Toolbars label="Learn" {items} second={CONTROLS} />
  <input
    bind:this={fileInput}
    type="file"
    accept=".mid,.midi,audio/midi"
    hidden
    onchange={(e) => {
      const file = e.currentTarget.files?.[0]
      e.currentTarget.value = ''
      if (file) onopen(file)
    }}
  />
</header>
