<script lang="ts">
  import { onMount } from 'svelte'
  import './lib/audio/sound.svelte'
  import { shortcuts } from './lib/device/shortcuts.svelte'
  import ShortcutsSheet from './lib/device/ShortcutsSheet.svelte'
  import { inputFocus } from './lib/input/focus.svelte'
  import { bindKeyboard } from './lib/input/keyboard.svelte'
  import { localizeLabels } from './lib/input/keymaps'
  import { MidiPorts } from './lib/input/midi.svelte'
  import { Room } from './lib/net/room.svelte'
  import PianoDevice from './lib/PianoDevice.svelte'
  import { platform } from './lib/platform'
  import { Player } from './lib/player.svelte'
  import SettingsSheet from './lib/SettingsSheet.svelte'
  import { settings } from './lib/settings.svelte'
  import { parseMidi, toMidi, type Song } from './lib/song'
  import { controls } from './lib/studio/controls.svelte'
  import StudioDevice from './lib/studio/StudioDevice.svelte'
  import { studio } from './lib/studio/studio.svelte'
  import SynthEditor from './lib/SynthEditor.svelte'
  import { theme } from './lib/theme.svelte'
  import { layout } from './lib/ui/layout.svelte'

  const player = new Player()
  const midi = new MidiPorts(player)
  midi.intercept = (message) => controls.handle(message, settings.workspace === 'studio')
  const room = new Room(player)
  const invitedCode = new URLSearchParams(location.hash.slice(1)).get('room') ?? ''
  // The Room store has picked up `?server=`; keep the address bar clean (the invite's #room stays until used).
  if (location.search) history.replaceState(history.state, '', location.pathname + location.hash)
  const TOAST_MS = 3000

  let dragging = $state(false)
  let toast = $state<{ text: string; error: boolean } | null>(null)
  let panel = $state<'settings' | 'synth' | 'shortcuts' | null>(null)
  let fileInput: HTMLInputElement

  const inStudio = $derived(settings.workspace === 'studio')
  /** #ui shows the UI library's gallery instead of the instrument. */
  const gallery = location.hash === '#ui'

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

  function notify(text: string, error = true) {
    const shown = { text, error }
    toast = shown
    setTimeout(() => toast === shown && (toast = null), TOAST_MS)
  }

  /** The piano's sound: docked beside the display on desktop, a panel elsewhere. */
  function showSound(toggle: boolean) {
    if (layout.kind === 'desktop' && !inStudio) {
      layout.inspector = toggle ? !layout.inspector : true
      panel = null
    } else panel = toggle && panel === 'synth' ? null : 'synth'
  }

  const exportMidi = () => saveSong(inStudio ? studio.practice() : player.song)

  $effect(() =>
    shortcuts.use('General', [
      { keys: ['Mod+/'], label: 'Shortcuts', run: () => (panel = 'shortcuts') },
      { keys: ['Mod+,'], label: 'Settings', run: () => (panel = 'settings') },
      { keys: ['Mod+O'], label: 'Open MIDI file', run: () => fileInput.click() },
      { keys: ['Mod+E'], label: 'Export MIDI file', run: exportMidi },
      { keys: ['Mod+S'], label: 'Save (Keyfall saves as you go)', run: () => notify(inStudio ? 'Saved · Studio saves as you go' : 'Nothing to save · Export MIDI with ⌘E', false) },
      { keys: ['Space'], label: 'Play / stop' },
      { keys: ['↑', '↓'], label: 'Keyboard octave up / down' },
    ]),
  )

  async function open(file: File) {
    try {
      const song = await parseMidi(file)
      if (inStudio) studio.openSong(song)
      else player.load(song)
    } catch {
      notify(`Can't read ${file.name}`)
    }
  }

  function openInStudio() {
    studio.openSong(player.song)
    settings.workspace = 'studio'
  }

  function practice() {
    if (!player.canControl) return notify('Only the room host can change the song')
    player.load(studio.practice())
    settings.workspace = 'learn'
  }

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

{#if gallery}
  {#await import('./lib/ui/Gallery.svelte') then { default: Gallery }}<Gallery />{/await}
{:else if inStudio}
  <StudioDevice {player} onimport={() => fileInput.click()} onexport={exportMidi} onpractice={practice} onsettings={() => (panel = 'settings')} />
{:else}
  <PianoDevice {player} {room} {invitedCode} onopen={() => fileInput.click()} onsave={exportMidi} onstudio={openInStudio} onsound={() => showSound(true)} onsettings={() => (panel = 'settings')} />
{/if}

{#if dragging}
  <div class="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-fg bg-bg/80 text-xl">Drop MIDI to load</div>
{/if}
{#if toast}
  <div class={['fixed top-4 right-4 z-50 rounded-lg px-3.5 py-2 text-bg', toast.error ? 'bg-danger' : 'bg-fg']} role="status">{toast.text}</div>
{/if}

{#if panel === 'settings'}
  <SettingsSheet {midi} onclose={() => (panel = null)} onsynth={() => showSound(false)} onshortcuts={() => (panel = 'shortcuts')} />
{:else if panel === 'synth'}
  <SynthEditor onclose={() => (panel = null)} />
{:else if panel === 'shortcuts'}
  <ShortcutsSheet onclose={() => (panel = null)} />
{/if}

<input
  bind:this={fileInput}
  type="file"
  accept=".mid,.midi,audio/midi"
  hidden
  onchange={(e) => {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (file) void open(file)
  }}
/>
