<script lang="ts">
  import { kitPads } from '../audio/samples'
  import Control from '../device/Control.svelte'
  import Device from '../device/Device.svelte'
  import { choiceKnob, rangeKnob, type KnobSpec } from '../device/knobs.svelte'
  import { hint, shortcuts } from '../device/shortcuts.svelte'
  import Button from '../ui/Button.svelte'
  import { hold } from '../ui/hold'
  import Menu from '../ui/Menu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import { layout } from '../ui/layout.svelte'
  import ValuePopover from '../device/ValuePopover.svelte'
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
  import { DEFAULT_TEMPO, KIT, MAX_BEATS_PER_BAR, MAX_TEMPO, MIN_TEMPO } from './project'
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

  const addDrums = () => studio.addTrack(KIT, kitPads(KIT))

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

  const tempo = rangeKnob('Tempo', MIN_TEMPO, MAX_TEMPO, () => studio.project.tempo, (v) => studio.setTempo(v), (v) => `${Math.round(v)}`, { initial: DEFAULT_TEMPO, step: 1 })

  const meter = choiceKnob('Bar', Array.from({ length: MAX_BEATS_PER_BAR }, (_, i) => i + 1), () => studio.project.beatsPerBar, (v) => studio.setBeatsPerBar(v), (v) => `${v}/4`, 4)

  /** Tap tempo: the average gap of the last few taps; a long pause starts over. */
  const TAP_RESET_MS = 2000
  const TAPS = 5
  let taps: number[] = []
  function tap() {
    const now = performance.now()
    if (now - (taps.at(-1) ?? 0) > TAP_RESET_MS) taps = []
    taps = [...taps, now].slice(-TAPS)
    if (taps.length > 1) studio.setTempo((60_000 * (taps.length - 1)) / (now - taps[0]))
  }

  /** The track menu: at the pointer (hold or right-click a track key), or under the phone's track chip with the list. */
  let trackMenu = $state<{ id: string; x?: number; y?: number; anchor?: HTMLElement; list?: boolean } | null>(null)
  /** Phones: the ⋯ menu, and a value it opened (tempo or bar) shown beside the same button. */
  let more = $state<HTMLElement | null>(null)
  let moreValue = $state<{ spec: KnobSpec; anchor: HTMLElement } | null>(null)
  const phone = $derived(layout.phone)
  const upright = $derived(layout.kind === 'upright')
  const menuTrack = $derived(tracks.find((t) => t.id === trackMenu?.id))
</script>

{#snippet tapTempo()}
  <button type="button" class="mx-1 mt-2 h-11 rounded bg-raised font-mono text-xs tracking-wider uppercase hover:bg-hover active:bg-fg active:text-bg" onpointerdown={tap} title="Tap along with the beat">Tap</button>
{/snippet}

{#snippet strip()}
  <div class="flex shrink-0 items-center gap-1">
    <button type="button" class={['grid size-10 place-items-center rounded-full', studio.recording ? 'bg-danger text-bg' : 'bg-raised text-danger']} onclick={() => studio.record()} aria-label={studio.recording ? 'Stop recording' : 'Record'} aria-pressed={!!studio.recording} title={hint('Record', 'Enter')}>
      <Icon name="record" filled class={studio.recording ? 'animate-pulse' : ''} />
    </button>
    <button type="button" class="grid size-10 place-items-center rounded-full bg-fg text-bg" onclick={() => studio.toggle()} aria-label={studio.playing ? 'Stop' : 'Play'} title={hint('Play / stop', 'Space')}>
      <Icon name={studio.playing ? 'stop' : 'play'} filled />
    </button>
    {#if !upright}<span class="min-w-[4.5ch] text-center font-mono text-lg tabular-nums" aria-label="Position">{bar}.{beat}</span>{/if}
    {#if !upright}
    <button
      type="button"
      class={['grid size-9 place-items-center rounded-md', studio.metronome ? 'bg-raised text-fg' : 'text-muted']}
      onclick={() => (studio.metronome = !studio.metronome)}
      aria-pressed={studio.metronome}
      aria-label="Metronome"
      title="Metronome on / off"><Icon name="metronome" /></button
    >
    {/if}
    <Control spec={tempo} variant="chip" extra={tapTempo} />
    {#if !upright}<Control spec={meter} variant="chip" />{/if}
  </div>

  {#if phone}
    <!-- Phones: one chip for the current track; the list and track actions open from it. -->
    <button
      type="button"
      class="flex h-control min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control bg-raised px-2.5 text-left"
      aria-haspopup="menu"
      aria-expanded={!!trackMenu?.list}
      aria-label="Track: {track?.name ?? 'none'}"
      onclick={(e) => (trackMenu = trackMenu?.list ? null : { id: track?.id ?? '', anchor: e.currentTarget, list: true })}
    >
      <span class="size-3 shrink-0 rounded-sm" style:background={color}></span>
      <span class="min-w-0 flex-1 truncate text-sm">{track ? `${index + 1} ${track.name}` : 'No track'}</span>
      <span class="text-muted" aria-hidden="true">▾</span>
    </button>
  {:else}
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
          use:hold={(point) => (studio.select(item.id), (trackMenu = { id: item.id, ...point }))}
          aria-pressed={selected}
          title="{item.name}{isKit(item) ? ' · drums' : ''} · double-click for its sound, right-click or hold for more">{bankStart + slot + 1}{isKit(item) ? '◆' : ''}</button
        >
      {:else}
        <button
          type="button"
          class="h-9 w-10 rounded-md border border-dashed border-line text-muted disabled:opacity-25 sm:w-14"
          onclick={() => studio.addTrack()}
          use:hold={(point) => (trackMenu = { id: '', ...point })}
          disabled={tracks.length >= MAX_TRACKS || slot > bank.length}
          aria-label="Add track"
          title="Add track · right-click or hold for a drum track">+</button
        >
      {/if}
    {/each}
    <button type="button" class="h-9 w-6 rounded text-muted disabled:opacity-25" onclick={() => selectBank(1)} disabled={bankStart + BANK >= tracks.length} aria-label="Next tracks">›</button>
  </div>

  {/if}

  <div class="flex shrink-0 items-center gap-1">
    <button type="button" class="grid size-9 place-items-center rounded-md text-muted disabled:opacity-30" onclick={() => studio.undo()} disabled={!studio.history.undo} aria-label="Undo" title={hint('Undo', 'Mod+Z')}><Icon name="undo" /></button>
    {#if phone}
      <button type="button" class="grid size-9 place-items-center rounded-md text-muted" aria-label="More" aria-haspopup="menu" aria-expanded={!!more} onclick={(e) => (more = more ? null : e.currentTarget)}><Icon name="more" /></button>
    {:else}
      <button type="button" class="h-9 rounded-md bg-raised px-2.5 font-mono text-[11px] tracking-wider uppercase" onclick={() => (settings.workspace = 'learn')} title="Back to the piano">Piano</button>
      <button type="button" class="grid size-9 place-items-center rounded-md text-muted" onclick={onsettings} aria-label="Settings" title={hint('Settings', 'Mod+,')}><Icon name="settings" /></button>
    {/if}
  </div>
{/snippet}

{#snippet display()}
  {#if !track}
    <!-- An empty project: three ways in, each one tap from making sound. -->
    <div class="grid content-center justify-items-center gap-4 p-6 text-center">
      <p class="text-lg font-medium">Start with</p>
      <div class="grid w-full max-w-sm gap-2">
        <Button size="md" variant="accent" onclick={() => (addDrums(), studioUi.show('pattern', 0))}>Drums · program a beat</Button>
        <Button size="md" onclick={() => (studio.addTrack(), studioUi.show('perform'))}>Synth · play and record</Button>
        <Button size="md" variant="ghost" onclick={onimport}>Open a MIDI file</Button>
      </div>
    </div>
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

<!-- Desktop: the track's sound beside any other mode, so it can be shaped while the pattern plays. -->
{#snippet inspector()}
  {#if track}<SoundScreen {track} {color} docked />{/if}
{/snippet}

{#snippet keys()}
  {#if track && isKit(track)}
    <PadsPanel {player} {track} {color} />
  {:else}
    <Roll {player} />
  {/if}
{/snippet}

<Device
  label="Studio"
  {strip}
  {display}
  modes={STUDIO_MODES}
  mode={studioUi.mode}
  page={studioUi.page}
  onmode={(mode) => studioUi.press(mode as StudioMode)}
  onpage={(page) => studioUi.show(studioUi.mode, page)}
  {keys}
  inspector={track && studioUi.mode !== 'sound' ? inspector : undefined}
  inspectorLabel="Track sound"
  keysDefault={studioUi.mode === 'perform'}
  keysPinned={!!studio.recording}
/>

{#if trackMenu}
  <Menu point={trackMenu.anchor ? undefined : { x: trackMenu.x ?? 0, y: trackMenu.y ?? 0 }} anchor={trackMenu.anchor} label={trackMenu.list ? 'Tracks' : menuTrack?.name} onclose={() => (trackMenu = null)}>
    {#if trackMenu.list}
      {#each tracks as item, i (item.id)}
        <MenuItem radio checked={item.id === track?.id} autofocus={item.id === track?.id} onclick={() => studio.select(item.id)}>
          <span class="size-2.5 shrink-0 rounded-sm" style:background={trackColor(i)}></span>{i + 1} {item.name}{isKit(item) ? ' ◆' : ''}
        </MenuItem>
      {/each}
      <hr class="my-1 border-line" />
    {/if}
    {#if menuTrack}
      <MenuItem onclick={() => studioUi.show('sound')}>Sound</MenuItem>
      <MenuItem onclick={() => (studioUi.show('sound'), (studioUi.renaming = true))}>Rename…</MenuItem>
      <MenuItem onclick={() => studio.edit(() => (menuTrack.muted = !menuTrack.muted))}>{menuTrack.muted ? 'Unmute' : 'Mute'}</MenuItem>
      <MenuItem onclick={() => studio.edit(() => (menuTrack.solo = !menuTrack.solo))}>{menuTrack.solo ? 'Unsolo' : 'Solo'}</MenuItem>
      <MenuItem destructive disabled={tracks.length <= 1} onclick={() => studio.removeTrack(menuTrack.id)}>Delete track</MenuItem>
      <hr class="my-1 border-line" />
    {/if}
    <MenuItem disabled={tracks.length >= MAX_TRACKS} onclick={() => studio.addTrack()}>New track</MenuItem>
    <MenuItem disabled={tracks.length >= MAX_TRACKS} onclick={addDrums}>New drum track</MenuItem>
  </Menu>
{/if}

<!-- Phones: what the top bar has no room for, in a fixed order. -->
{#if more}
  {@const anchor = more}
  <Menu {anchor} label="Studio" onclose={() => (more = null)}>
    {#if upright}
      <MenuItem checked={studio.metronome} onclick={() => (studio.metronome = !studio.metronome)}>Metronome</MenuItem>
      <MenuItem onclick={() => (moreValue = { spec: meter, anchor })}>Bar · {meter.display()}</MenuItem>
    {/if}
    <MenuItem disabled={!studio.history.redo} onclick={() => studio.redo()}>Redo</MenuItem>
    <MenuItem onclick={() => (settings.workspace = 'learn')}>Piano</MenuItem>
    <MenuItem onclick={onsettings}>Settings</MenuItem>
  </Menu>
{/if}
{#if moreValue}
  <ValuePopover spec={moreValue.spec} anchor={moreValue.anchor} onclose={() => (moreValue = null)} />
{/if}
