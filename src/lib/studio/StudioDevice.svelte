<script lang="ts">
  import { DRUMS } from '../audio/drums'
  import { BUILTIN } from '../audio/samples'
  import Device from '../device/Device.svelte'
  import { hint, shortcuts } from '../device/shortcuts.svelte'
  import Menu from '../ui/Menu.svelte'
  import type { Player } from '../player.svelte'
  import Roll from '../Roll.svelte'
  import { settings } from '../settings.svelte'
  import Icon from '../ui/Icon.svelte'
  import { trackColor } from './Arrangement.svelte'
  import PadsPanel from './PadsPanel.svelte'
  import MixScreen from './screens/MixScreen.svelte'
  import PatternScreen from './screens/PatternScreen.svelte'
  import PerformScreen from './screens/PerformScreen.svelte'
  import SongScreen from './screens/SongScreen.svelte'
  import SoundScreen from './screens/SoundScreen.svelte'
  import { controls } from './controls.svelte'
  import { KIT } from './project'
  import { isKit, MAX_TRACKS, studio } from './studio.svelte'
  import { BANK, STUDIO_MODES, studioUi, type StudioMode } from './ui.svelte'

  let {
    player,
    onimport,
    onexport,
    onpractice,
    onsettings,
  }: { player: Player; onimport: () => void; onexport: () => void; onpractice: () => void; onsettings: () => void } = $props()

  const tracks = $derived(studio.project.tracks)
  const index = $derived(Math.max(0, studio.trackIndex))
  const bankStart = $derived(Math.floor(index / BANK) * BANK)
  const bank = $derived(tracks.slice(bankStart, bankStart + BANK))
  const track = $derived(studio.track)
  const color = $derived(trackColor(index))
  const bar = $derived(Math.floor(studio.position / studio.project.beatsPerBar) + 1)
  const beat = $derived(Math.floor(studio.position % studio.project.beatsPerBar) + 1)

  /** Recording follows the screen: the timeline in Song, the selected pattern everywhere else. */
  $effect(() => {
    studio.view = studioUi.mode === 'song' ? 'arrange' : 'session'
  })

  $effect(() => {
    studio.attach(player)
    return () => studio.detach()
  })

  function selectBank(direction: 1 | -1) {
    const next = tracks[Math.max(0, Math.min(tracks.length - 1, bankStart + direction * BANK))]
    if (next) studio.select(next.id)
  }

  function selectTrack(direction: 1 | -1) {
    const next = tracks[Math.max(0, Math.min(tracks.length - 1, index + direction))]
    if (next) studio.select(next.id)
  }

  const addDrums = () => studio.addTrack(KIT, DRUMS.map((d) => ({ midi: d.midi, name: d.name, sample: BUILTIN + d.id })))

  /** Escape backs out of whatever mode is on, most specific first. */
  function escape() {
    if (controls.learnKnob !== null) controls.learnKnob = null
    else if (controls.learning) ((controls.learning = false), (controls.armed = null))
    else if (studio.stepInput) studio.stepInput = null
    else if (studio.launchMode) studio.toggleLaunchMode()
  }

  $effect(() =>
    shortcuts.use('Studio', [
      { keys: ['Mod+Z'], label: 'Undo', run: () => studio.undo() },
      { keys: ['Mod+Shift+Z', 'Mod+Y'], label: 'Redo', run: () => studio.redo() },
      { keys: ['Alt+↑', 'Alt+↓'], label: 'Previous / next track', run: (e) => selectTrack(e.code === 'ArrowUp' ? -1 : 1) },
      { keys: ['Escape'], label: 'Leave step input, key launch or MIDI map', run: escape, when: () => controls.learnKnob !== null || controls.learning || !!studio.stepInput || studio.launchMode },
      { keys: ['Enter'], label: 'Record' },
      { keys: ['←', '→'], label: 'Previous / next bar (step input: previous / next step)' },
      { keys: ['Backspace'], label: 'Back to start (step input: erase previous step)' },
      { keys: ['Tab'], label: 'Keys launch on / off (with the piano keyboard focused)' },
    ]),
  )

  let trackMenu = $state<{ id: string; x: number; y: number } | null>(null)
  const menuTrack = $derived(tracks.find((t) => t.id === trackMenu?.id))
</script>

{#snippet strip()}
  <div class="flex items-center gap-1">
    <button type="button" class={['grid size-10 place-items-center rounded-full', studio.recording ? 'bg-danger text-bg' : 'bg-raised text-danger']} onclick={() => studio.record()} aria-label={studio.recording ? 'Stop recording' : 'Record'} aria-pressed={!!studio.recording} title={hint('Record', 'Enter')}>
      <Icon name="record" filled class={studio.recording ? 'animate-pulse' : ''} />
    </button>
    <button type="button" class="grid size-10 place-items-center rounded-full bg-fg text-bg" onclick={() => studio.toggle()} aria-label={studio.playing ? 'Stop' : 'Play'} title={hint('Play / stop', 'Space')}>
      <Icon name={studio.playing ? 'stop' : 'play'} filled />
    </button>
    <span class="min-w-[4.5ch] text-center font-mono text-lg tabular-nums" aria-label="Position">{bar}.{beat}</span>
    <button
      type="button"
      class={['h-8 rounded-md px-2 font-mono text-xs', studio.metronome ? 'bg-raised text-fg' : 'text-muted']}
      onclick={() => (studio.metronome = !studio.metronome)}
      aria-pressed={studio.metronome}
      title="Metronome on/off · tempo is on the Perform knobs">♩{studio.project.tempo}</button
    >
  </div>

  <div class="mx-auto flex items-center gap-1" role="group" aria-label="Tracks">
    <button type="button" class="h-9 w-6 rounded text-muted disabled:opacity-25" onclick={() => selectBank(-1)} disabled={bankStart === 0} aria-label="Previous tracks">‹</button>
    {#each { length: BANK } as _, slot}
      {@const item = bank[slot]}
      {#if item}
        {@const selected = item.id === track?.id}
        <button
          type="button"
          class={['h-9 w-10 rounded-md font-mono text-sm sm:w-14', selected ? 'text-bg' : 'bg-raised']}
          style:background={selected ? trackColor(bankStart + slot) : undefined}
          style:box-shadow={selected ? undefined : `inset 0 -3px 0 ${trackColor(bankStart + slot)}`}
          onclick={() => studio.select(item.id)}
          ondblclick={() => studioUi.show('sound')}
          oncontextmenu={(e) => (e.preventDefault(), studio.select(item.id), (trackMenu = { id: item.id, x: e.clientX, y: e.clientY }))}
          aria-pressed={selected}
          title="{item.name}{isKit(item) ? ' · drums' : ''} · double-click for its sound, right-click for more">{bankStart + slot + 1}{isKit(item) ? '◆' : ''}</button
        >
      {:else}
        <button
          type="button"
          class="h-9 w-10 rounded-md border border-dashed border-line text-muted disabled:opacity-25 sm:w-14"
          onclick={() => studio.addTrack()}
          oncontextmenu={(e) => (e.preventDefault(), (trackMenu = { id: '', x: e.clientX, y: e.clientY }))}
          disabled={tracks.length >= MAX_TRACKS || slot > bank.length}
          aria-label="Add track"
          title="Add track · right-click for a drum track">+</button
        >
      {/if}
    {/each}
    <button type="button" class="h-9 w-6 rounded text-muted disabled:opacity-25" onclick={() => selectBank(1)} disabled={bankStart + BANK >= tracks.length} aria-label="Next tracks">›</button>
  </div>

  <div class="flex items-center gap-1">
    <button type="button" class="grid size-9 place-items-center rounded-md text-muted disabled:opacity-30" onclick={() => studio.undo()} disabled={!studio.history.undo} aria-label="Undo" title={hint('Undo', 'Mod+Z')}><Icon name="undo" /></button>
    <button type="button" class="h-9 rounded-md bg-raised px-2.5 font-mono text-[11px] tracking-wider uppercase" onclick={() => (settings.workspace = 'learn')} title="Back to the piano">Piano</button>
    <button type="button" class="grid size-9 place-items-center rounded-md text-muted" onclick={onsettings} aria-label="Settings" title={hint('Settings', 'Mod+,')}><Icon name="settings" /></button>
  </div>
{/snippet}

{#snippet display()}
  {#if !track}
    <p class="p-4 text-muted">Add a track to start.</p>
  {:else if studioUi.mode === 'sound'}
    <SoundScreen {track} {color} page={studioUi.page} />
  {:else if studioUi.mode === 'pattern'}
    <PatternScreen {track} {color} page={studioUi.page} />
  {:else if studioUi.mode === 'perform'}
    <PerformScreen {bank} page={studioUi.page} />
  {:else if studioUi.mode === 'song'}
    <SongScreen {onimport} {onexport} {onpractice} />
  {:else}
    <MixScreen {bank} />
  {/if}
{/snippet}

{#snippet keys()}
  {#if track && isKit(track)}
    <PadsPanel {player} {track} {color} />
  {:else}
    <Roll {player} />
  {/if}
{/snippet}

<Device label="Studio" {strip} {display} modes={STUDIO_MODES} mode={studioUi.mode} page={studioUi.page} onmode={(mode) => studioUi.press(mode as StudioMode)} {keys} />

{#if trackMenu}
  <Menu point={trackMenu} onclose={() => (trackMenu = null)}>
    {#if menuTrack}
      <button type="button" role="menuitem" onclick={() => studioUi.show('sound')}>Sound</button>
      <button type="button" role="menuitem" onclick={() => (studioUi.show('sound'), (studioUi.renaming = true))}>Rename…</button>
      <button type="button" role="menuitem" onclick={() => studio.edit(() => (menuTrack.muted = !menuTrack.muted))}>{menuTrack.muted ? 'Unmute' : 'Mute'}</button>
      <button type="button" role="menuitem" onclick={() => studio.edit(() => (menuTrack.solo = !menuTrack.solo))}>{menuTrack.solo ? 'Unsolo' : 'Solo'}</button>
      <button type="button" role="menuitem" data-destructive disabled={tracks.length <= 1} onclick={() => studio.removeTrack(menuTrack.id)}>Delete track</button>
      <hr class="my-1 border-line" />
    {/if}
    <button type="button" role="menuitem" disabled={tracks.length >= MAX_TRACKS} onclick={() => studio.addTrack()}>New track</button>
    <button type="button" role="menuitem" disabled={tracks.length >= MAX_TRACKS} onclick={addDrums}>New drum track</button>
  </Menu>
{/if}
