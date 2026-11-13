<script lang="ts">
  import { untrack } from 'svelte'
  import { sound } from './audio/sound.svelte'
  import Device, { type Mode } from './device/Device.svelte'
  import { choiceKnob, knobs, parseNumber, percentKnob, rangeKnob, type KnobSpec } from './device/knobs.svelte'
  import { hint, shortcuts } from './device/shortcuts.svelte'
  import SoftKeys from './device/SoftKeys.svelte'
  import { noteName } from './input/keymaps'
  import type { Room } from './net/room.svelte'
  import { MODES, type Player } from './player.svelte'
  import Roll from './Roll.svelte'
  import RoomPanel from './RoomPanel.svelte'
  import { MAX_TRANSPOSE, settings } from './settings.svelte'
  import Icon from './ui/Icon.svelte'

  /** The front door: a playable piano. Play freely, learn a song with falling notes, or play together in a room. */
  let {
    player,
    room,
    invitedCode,
    onopen,
    onsave,
    onstudio,
    onsettings,
  }: { player: Player; room: Room; invitedCode: string; onopen: () => void; onsave: () => void; onstudio: () => void; onsettings: () => void } = $props()

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
          choiceKnob('Sound', sound.presets.map((p) => p.id), () => sound.presetId, (id) => sound.select(id), (id) => sound.find(id).name, sound.presets[0]?.id),
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

{#snippet strip()}
  {#if mode === 'learn'}
    <button type="button" class="grid size-10 shrink-0 place-items-center rounded-full bg-fg text-bg disabled:opacity-40" onclick={() => player.toggle()} disabled={locked} aria-label={player.playing ? 'Pause' : 'Play'} title={hint('Play / pause', 'Space')}>
      <Icon name={player.playing ? 'pause' : 'play'} filled={!player.playing} />
    </button>
  {/if}
  <div class="min-w-0">
    <div class="truncate text-base font-medium">{mode === 'learn' ? player.song.name : mode === 'room' && connected ? room.details?.name || `Room ${room.code}` : 'Keyfall'}</div>
    <div class="truncate font-mono text-[11px] text-muted uppercase">
      {mode === 'learn' ? `${player.mode} · ${accuracy}` : connected ? `${room.peers.size + 1} in the room` : 'free play'}
    </div>
  </div>
  <span class="flex-1"></span>
  {#if connected && mode !== 'room'}
    <button type="button" class="h-9 rounded-md bg-raised px-2.5 font-mono text-[11px]" onclick={() => (mode = 'room')}><Icon name="users" class="inline size-4" /> {room.peers.size + 1}</button>
  {/if}
  <button type="button" class="h-9 rounded-md bg-raised px-2.5 font-mono text-[11px] tracking-wider uppercase" onclick={onstudio} title="Open in Studio: the song comes along">Studio</button>
  <button type="button" class="grid size-9 place-items-center rounded-md text-muted" onclick={onsettings} aria-label="Settings" title={hint('Settings', 'Mod+,')}><Icon name="settings" /></button>
{/snippet}

{#snippet display()}
  {#if mode === 'room'}
    <RoomPanel {room} {player} initialCode={invitedCode} />
  {:else}
    <div class="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <Roll {player} />
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
    </div>
  {/if}
{/snippet}

<Device label="Piano" {strip} {display} modes={PIANO_MODES} {mode} onmode={(next) => (mode = next as PianoMode)} />
