<script lang="ts">
  import { onMount } from 'svelte'
  import { inputFocus } from './lib/input/focus.svelte'
  import { theme } from './lib/theme.svelte'
  import Progress from './lib/Progress.svelte'
  import Roll from './lib/Roll.svelte'
  import RoomPanel from './lib/RoomPanel.svelte'
  import SettingsSheet from './lib/SettingsSheet.svelte'
  import SynthEditor from './lib/SynthEditor.svelte'
  import Toolbar from './lib/Toolbar.svelte'
  import StudioView from './lib/studio/StudioView.svelte'
  import TransportBar from './lib/studio/TransportBar.svelte'
  import { controls } from './lib/studio/controls.svelte'
  import { studio } from './lib/studio/studio.svelte'
  import { bindKeyboard } from './lib/input/keyboard.svelte'
  import { localizeLabels } from './lib/input/keymaps'
  import { MidiPorts } from './lib/input/midi.svelte'
  import { Room } from './lib/net/room.svelte'
  import './lib/audio/sound.svelte'
  import { platform } from './lib/platform'
  import { Player } from './lib/player.svelte'
  import { settings } from './lib/settings.svelte'
  import { parseMidi, toMidi, type Song } from './lib/song'
  import Kbd from './lib/ui/Kbd.svelte'

  const player = new Player()
  const midi = new MidiPorts(player)
  midi.intercept = (message) => settings.workspace === 'studio' && controls.handle(message)
  const room = new Room(player)
  const invitedCode = new URLSearchParams(location.hash.slice(1)).get('room') ?? ''
  const TOAST_MS = 3000

  let dragging = $state(false)
  let toast = $state('')
  let panel = $state<'settings' | 'synth' | 'room' | null>(invitedCode ? 'room' : null)

  const learning = $derived(settings.workspace === 'learn')

  onMount(() => {
    const stopTheme = theme.start()
    const stopFocus = inputFocus.start()
    localizeLabels().then(() => (player.dirty = true))
    void midi.restore()
    const unbind = bindKeyboard(player)
    return () => {
      stopTheme()
      stopFocus()
      unbind()
      room.leave()
      midi.close()
    }
  })

  function notify(message: string) {
    toast = message
    setTimeout(() => (toast = ''), TOAST_MS)
  }

  async function open(file: File) {
    try {
      const song = await parseMidi(file)
      if (learning) player.load(song)
      else studio.openSong(song)
    } catch {
      notify(`Can't read ${file.name}`)
    }
  }

  function openInStudio() {
    studio.openSong(player.song)
    settings.workspace = 'studio'
  }

  function practice(trackIds?: string[]) {
    if (!player.canControl) return notify('Only the room host can change the song')
    player.load(studio.practice(trackIds))
    settings.workspace = 'learn'
  }

  const save = () => saveSong(player.song)

  async function saveSong(song: Song) {
    try {
      await platform.saveFile(`${song.name}.mid`, await toMidi(song))
    } catch (error) {
      notify(`Save failed: ${error}`)
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const file = e.dataTransfer?.files[0]
    if (file) void open(file)
  }
</script>

<svelte:window
  ondragover={(e) => {
    e.preventDefault()
    dragging = true
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
/>

{#if !learning}
  <main class="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr] pb-[env(safe-area-inset-bottom)]">
    <TransportBar onimport={open} onexport={() => saveSong(studio.practice())} onpractice={() => practice()} onsettings={() => (panel = 'settings')} />
    <StudioView {player} onpractice={practice} />
    {#if toast}
      <div class="fixed top-4 right-4 z-50 rounded-lg bg-danger px-3.5 py-2">{toast}</div>
    {/if}
  </main>
{:else}
<main class="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_1fr] pb-[env(safe-area-inset-bottom)]">
  <Toolbar {player} onopen={open} onsave={save} onsettings={() => (panel = 'settings')} {room} onroom={() => (panel = 'room')} onstudio={openInStudio} />
  <Progress value={Math.max(0, player.time)} max={player.song.duration} onseek={(time) => player.seek(time)} />

  <section class="relative min-h-0">
    <Roll {player} />

    <p class="pointer-events-none absolute top-4 left-1/2 m-0 -translate-x-1/2 whitespace-nowrap text-muted max-md:hidden">
      {#if settings.editing}
        <span class="text-fg">{settings.editTarget === null ? 'Click a piano key' : 'Press a keyboard key to bind'}</span>
        · <Kbd>Del</Kbd> unbind · <Kbd>Esc</Kbd> done
      {:else if !player.playing}
        <Kbd>Space</Kbd> play · <Kbd>↑</Kbd><Kbd>↓</Kbd> octave · <Kbd>{settings.keymap.shifted ? '`' : 'Shift'}</Kbd> sustain · <Kbd>←</Kbd><Kbd>→</Kbd> seek · drop a MIDI file
      {/if}
    </p>

    {#if dragging}
      <div class="pointer-events-none absolute inset-3 grid place-items-center rounded-2xl border-2 border-dashed border-accent bg-bg/80 text-xl">
        Drop MIDI to load
      </div>
    {/if}
    {#if toast}
      <div class="absolute top-4 right-4 rounded-lg bg-danger px-3.5 py-2">{toast}</div>
    {/if}
  </section>
</main>
{/if}

{#if panel === 'settings'}
  <SettingsSheet {midi} onclose={() => (panel = null)} onsynth={() => (panel = 'synth')} />
{:else if panel === 'synth'}
  <SynthEditor onclose={() => (panel = null)} />
{:else if panel === 'room'}
  <RoomPanel {room} {player} initialCode={invitedCode} onclose={() => (panel = null)} />
{/if}
