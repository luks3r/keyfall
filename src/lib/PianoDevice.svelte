<script lang="ts">
  import { untrack } from 'svelte'
  import { presetGroup, sound } from './audio/sound.svelte'
  import Device, { type Mode } from './device/Device.svelte'
  import { choiceKnob, knobs, parseNumber, percentKnob, rangeKnob, type KnobSpec } from './device/knobs.svelte'
  import { hint, shortcuts } from './device/shortcuts.svelte'
  import SoftKeys from './device/SoftKeys.svelte'
  import { noteName } from './input/keymaps'
  import type { Room } from './net/room.svelte'
  import { MODES, type Player } from './player.svelte'
  import Roll from './Roll.svelte'
  import RoomPanel from './RoomPanel.svelte'
  import SynthEditor from './SynthEditor.svelte'
  import { MAX_TRANSPOSE, settings } from './settings.svelte'
  import Button from './ui/Button.svelte'
  import Icon from './ui/Icon.svelte'
  import { layout } from './ui/layout.svelte'

  /** The front door: a playable piano. Play freely, learn a song with falling notes, or play together in a room. */
  let {
    player,
    room,
    invitedCode,
    onopen,
    onsave,
    onstudio,
    onsound,
    onsettings,
  }: { player: Player; room: Room; invitedCode: string; onopen: () => void; onsave: () => void; onstudio: () => void; onsound: () => void; onsettings: () => void } = $props()

  type PianoMode = 'play' | 'learn' | 'room'
  const PIANO_MODES: Mode[] = [
    { id: 'play', label: 'Play' },
    { id: 'learn', label: 'Learn' },
    { id: 'room', label: 'Room' },
  ]
  const OCTAVE_STEPS = Array.from({ length: 9 }, (_, i) => i)
  const DEFAULT_OCTAVE = 4
  const DEFAULT_VOLUME = 0.8
  const clock = (v: number) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`
  /** "1:30" or "90" (seconds). */
  const parseClock = (text: string) => {
    const [minutes, seconds] = text.split(':')
    if (seconds === undefined) return parseNumber(text)
    const m = Number(minutes)
    const sec = Number(seconds)
    return Number.isFinite(m) && Number.isFinite(sec) ? m * 60 + sec : null
  }

  let mode = $state<PianoMode>(untrack(() => (invitedCode ? 'room' : 'play')))

  /** A one-time tip in Learn on a phone held upright when the song is wider than the keys. */
  const TIP_KEY = 'keyfall.tip.sideways'
  let tipSeen = $state((() => {
    try {
      return localStorage.getItem(TIP_KEY) === '1'
    } catch {
      return false
    }
  })())
  function seeTip() {
    tipSeen = true
    try {
      localStorage.setItem(TIP_KEY, '1')
    } catch {}
  }
  const connected = $derived(room.status === 'connected')
  const locked = $derived(!player.canControl)
  const accuracy = $derived.by(() => {
    const total = player.hits + player.misses
    return total ? `${Math.round((100 * player.hits) / total)}%` : '—'
  })

  /** Play mode is free playing: your notes rise as strokes and no song runs. */
  $effect(() => {
    const free = mode === 'play'
    if (free && player.playing && player.canControl) player.toggle()
    player.studio = free
    player.dirty = true
    return () => {
      // Studio may already have taken over the player as this screen goes away; leave it capturing.
      if (!player.studioKeys) player.studio = false
      player.dirty = true
    }
  })

  const octave = () => choiceKnob('Octave', OCTAVE_STEPS, () => Math.round(player.base / 12), (v) => player.shift(v * 12 - player.base), (v) => noteName(v * 12 + settings.transpose), DEFAULT_OCTAVE)
  const specs = $derived.by((): (KnobSpec | null)[] =>
    mode === 'learn'
      ? [
          rangeKnob('Speed', 0.25, 1.5, () => player.speed, (v) => !locked && player.setSpeed(v), (v) => `${Math.round(v * 100)}%`, {
            initial: 1,
            step: 0.05,
            parse: (text) => {
              const v = parseNumber(text)
              return v === null ? null : v / 100
            },
          }),
          choiceKnob('Wait', MODES, () => player.mode, (v) => !locked && player.setMode(v), (v) => (v === 'wait' ? 'for you' : 'off'), 'wait'),
          rangeKnob('Position', 0, Math.max(1, player.song.duration), () => Math.max(0, player.time), (v) => !locked && player.seek(v), clock, { initial: 0, step: 1, parse: parseClock }),
          octave(),
        ]
      : [
          octave(),
          choiceKnob('Sound', sound.presets.map((p) => p.id), () => sound.presetId, (id) => sound.select(id), (id) => sound.find(id).name, sound.presets[0]?.id, (id) => presetGroup(sound.find(id))),
          percentKnob('Volume', () => settings.volume, (v) => (settings.volume = v), DEFAULT_VOLUME),
          rangeKnob('Transpose', -MAX_TRANSPOSE, MAX_TRANSPOSE, () => settings.transpose, (v) => (settings.transpose = Math.round(v)), (v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`, { initial: 0, step: 1 }),
        ],
  )

  $effect(() => knobs.use(specs))

  $effect(() =>
    mode === 'learn'
      ? shortcuts.use('Learn', [
          { keys: ['Space'], label: 'Play / pause the song' },
          { keys: ['←', '→'], label: 'Back / ahead 5 seconds' },
          { keys: ['Backspace'], label: 'Back to the start' },
        ])
      : undefined,
  )
</script>

{#snippet playButton()}
  <button type="button" class="grid size-11 shrink-0 place-items-center rounded-full bg-fg text-bg disabled:opacity-40" onclick={() => player.toggle()} disabled={locked} aria-label={player.playing ? 'Pause' : 'Play'} title={hint('Play / pause', 'Space')}>
    <Icon name={player.playing ? 'pause' : 'play'} filled={!player.playing} />
  </button>
{/snippet}

{#snippet title()}
  <div class="min-w-0">
    <div class="truncate text-base font-medium">{mode === 'learn' ? player.song.name : mode === 'room' && connected ? room.details?.name || `Room ${room.code}` : 'Keyfall'}</div>
    <div class="label truncate text-muted">
      {mode === 'learn' ? `${player.mode} · ${accuracy}` : connected ? `${room.peers.size + 1} in the room` : 'free play'}
    </div>
  </div>
{/snippet}

<!-- Sound, Studio and Settings: in the top bar, or behind ☰ on phones. -->
{#snippet tools()}
  {#if connected && mode !== 'room'}
    <Button size="sm" caps onclick={() => (mode = 'room')}><Icon name="users" class="size-4" /> {room.peers.size + 1}</Button>
  {/if}
  <Button size="sm" caps onclick={onsound} title="Pick and shape the piano's sound"><Icon name="wave" class="size-4" />{sound.preset.name}</Button>
  <Button size="sm" caps onclick={onstudio} title="Open in Studio: the song comes along">Studio</Button>
  <Button size="sm" variant="ghost" shape="square" class="text-muted" onclick={onsettings} aria-label="Settings" title={hint('Settings', 'Mod+,')}><Icon name="settings" /></Button>
{/snippet}

{#snippet strip()}
  {#if mode === 'learn'}{@render playButton()}{/if}
  {@render title()}
  <span class="flex-1"></span>
  {@render tools()}
{/snippet}

<!-- Phones: what stays beside ☰ while the keys own the screen. -->
{#snippet quick()}
  {#if mode === 'learn'}{@render playButton()}{/if}
  {#if mode === 'play'}
    <button type="button" class="min-w-0 truncate text-left text-base font-medium" onclick={onsound} title="Pick and shape the piano's sound">{sound.preset.name}</button>
  {:else}
    {@render title()}
  {/if}
  <span class="flex-1"></span>
  {#if mode !== 'room'}
    <div class="flex shrink-0 items-center gap-1" role="group" aria-label="Octave">
      <Button shape="square" aria-label="Octave down" onclick={() => player.shift(-12)} disabled={player.base < 12}><Icon name="minus" /></Button>
      <span class="label w-8 text-center">{noteName(Math.round(player.base / 12) * 12 + settings.transpose)}</span>
      <Button shape="square" aria-label="Octave up" onclick={() => player.shift(12)} disabled={player.base > 96}><Icon name="plus" /></Button>
    </div>
  {/if}
{/snippet}

{#snippet actions()}
  {#if mode === 'learn'}
    <SoftKeys
      keys={[
        { label: 'Restart', onclick: () => player.restart(), disabled: locked, title: 'Back to the start', shortcut: 'Backspace' },
        { label: 'Open MIDI', onclick: onopen, disabled: locked, shortcut: 'Mod+O' },
        { label: 'Fit keys', onclick: () => player.fit(), title: 'Show just the keys this song uses' },
        { label: 'Export MIDI', onclick: onsave, shortcut: 'Mod+E' },
      ]}
    />
  {/if}
{/snippet}

{#snippet display()}
  {#if mode === 'room'}
    <!-- The keys stay playable while you wait for people or talk them through a song. -->
    <div class="grid min-h-0 grid-rows-[minmax(0,1fr)_clamp(130px,30%,240px)]">
      <div class="grid min-h-0">
        <RoomPanel {room} {player} initialCode={invitedCode} />
      </div>
      <div class="min-h-0 border-t border-line"><Roll {player} keysShare={0.85} /></div>
    </div>
  {:else}
    <div class="relative grid min-h-0">
      <Roll {player} keysShare={layout.phone && mode === 'play' ? 0.5 : undefined} />
      {#if mode === 'learn' && layout.kind === 'upright' && player.wide && !tipSeen}
        <div class="absolute inset-x-2 top-2 flex items-center gap-2 rounded-control bg-surface/95 py-1 pr-1 pl-3 text-sm shadow-lg shadow-black/30" role="note">
          <span class="flex-1">The keys follow the song. Turn your phone sideways to see more of them.</span>
          <Button size="sm" variant="ghost" shape="square" aria-label="Got it" onclick={seeTip}><Icon name="close" /></Button>
        </div>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet inspector()}
  <SynthEditor docked />
{/snippet}

<Device label="Piano" {strip} {quick} {tools} {display} {actions} {inspector} inspectorLabel="Sound" keysFirst modes={PIANO_MODES} {mode} onmode={(next) => (mode = next as PianoMode)} />
