<script lang="ts">
  import { KITS } from '../../audio/drums'
  import { engine } from '../../audio/engine.svelte'
  import type { SynthPatch } from '../../audio/patch'
  import { patchControls, SECTIONS, sectionKnobs, type SoundSection } from '../../audio/patch-controls'
  import { importSample, kitPads } from '../../audio/samples'
  import { presetGroup, sound } from '../../audio/sound.svelte'
  import Control from '../../device/Control.svelte'
  import { choiceKnob, knobs, percentKnob, type KnobSpec } from '../../device/knobs.svelte'
  import SoftKeys from '../../device/SoftKeys.svelte'
  import { noteName } from '../../input/keymaps'
  import SoundEditor from '../../SoundEditor.svelte'
  import { focusOnMount } from '../../ui/focus'
  import { DEFAULT_PRESET, type Track } from '../project'
  import { isKit, isKitPreset, studio, trackChannel } from '../studio.svelte'
  import { studioUi } from '../ui.svelte'

  /**
   * The selected track's instrument. Synths open in the sound editor, one section per page (Voice, Osc, Env,
   * Filter, FM) with the four knobs on that section. Sampled sounds have a voice only; kits show their pads.
   *
   * `docked`: the desktop inspector beside another mode. It keeps its own section and leaves the knobs to that mode.
   */
  let { track, color, page = 0, docked = false }: { track: Track; color: string; page?: number; docked?: boolean } = $props()

  const AUDITION_MS = 400
  const TRACK_LEVEL = 0.8
  const kit = $derived(isKit(track))
  const preset = $derived(sound.find(track.preset))
  const original = $derived(preset.kind === 'synth' ? preset.patch : null)
  const patch = $derived<SynthPatch | null>(kit ? null : (track.patch ?? original))
  const pads = $derived([...track.pads].sort((a, b) => a.midi - b.midi))
  const channel = $derived(trackChannel(studio.project.tracks.indexOf(track)))
  let dockedSection = $state<SoundSection>('voice')
  const section = $derived<SoundSection>(!patch ? 'voice' : docked ? dockedSection : (SECTIONS[page]?.id ?? 'voice'))

  let padIndex = $state(0)
  let osc = $state(0)
  let naming = $state(false)
  let fileInput: HTMLInputElement
  const pad = $derived(pads[Math.min(padIndex, pads.length - 1)])

  function setPreset(id: string) {
    if (id === track.preset) return
    studio.tweak(() => {
      track.preset = id
      track.patch = undefined
      if (isKitPreset(id)) track.pads = kitPads(id)
    })
  }

  /** Copies the preset into the track the first time the sound changes. */
  function edit(change: (patch: SynthPatch) => void) {
    if (!original) return
    studio.tweak(() => {
      track.patch ??= structuredClone($state.snapshot(original))
      change(track.patch)
    })
  }

  function saveAsPreset(name: string) {
    naming = false
    if (!patch) return
    const id = sound.addPreset(name, $state.snapshot(patch))
    studio.edit(() => {
      track.preset = id
      track.patch = undefined
    })
  }

  const presetName = (id: string) => KITS.find((kit) => kit.id === id)?.name ?? sound.find(id).name
  const instrument = $derived(
    choiceKnob('Instrument', [...sound.presets.map((p) => p.id), ...KITS.map((kit) => kit.id)], () => track.preset, setPreset, presetName, DEFAULT_PRESET, (id) => (isKitPreset(id) ? 'Drums' : presetGroup(sound.find(id)))),
  )
  const level = $derived(percentKnob('Level', () => track.volume, (v) => studio.tweak(() => (track.volume = v)), TRACK_LEVEL))
  // Knob closures outlive this patch (undo, switching to a kit); each set reads the patch it was made for.
  const controls = $derived(patch ? patchControls(patch, original, edit) : null)

  const specs = $derived.by((): (KnobSpec | null)[] => {
    if (kit) {
      return [
        instrument,
        pads.length ? choiceKnob('Pad', pads.map((_, i) => i), () => padIndex, (i) => ((padIndex = i), audition(pads[i].midi)), (i) => pads[i]?.name ?? '', 0) : null,
        level,
        null,
      ]
    }
    if (!controls || section === 'voice') return [instrument, level, controls?.gain ?? null, controls?.keyTrack ?? null]
    return sectionKnobs(section, controls, osc)
  })

  $effect(() => (docked ? undefined : knobs.use(specs)))

  function audition(midi: number) {
    const voice = engine.noteOn(midi, 0.9, channel)
    setTimeout(() => voice.stop(), AUDITION_MS)
  }

  async function load(file: File) {
    if (!pad) return
    const key = await importSample(file)
    studio.edit(() => {
      pad.sample = key
      pad.name = file.name.replace(/\.[^.]+$/, '')
    })
  }
</script>

{#snippet voice()}
  <div class="grid grid-cols-2 gap-2">
    <Control spec={instrument} color="var(--color-knob-blue)" />
    <Control spec={level} color="var(--color-knob-green)" />
  </div>
{/snippet}

{#snippet nameField(value: string, label: string, done: (text: string | null) => void)}
  <input
    class={['min-w-0 flex-1 bg-transparent font-medium outline-none', docked ? 'text-lg' : 'text-2xl']}
    {value}
    aria-label={label}
    placeholder={label}
    use:focusOnMount
    onblur={(e) => done(e.currentTarget.value.trim() || null)}
    onkeydown={(e) => {
      if (e.key === 'Enter') e.currentTarget.blur()
      else if (e.key === 'Escape') ((e.currentTarget.value = ''), e.currentTarget.blur())
    }}
  />
{/snippet}

<div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
  <div class="flex items-baseline gap-3 px-4 pt-3 pb-1">
    {#if naming}
      {@render nameField(`${presetName(track.preset)} (${track.name})`, 'Preset name', (name) => (name ? saveAsPreset(name) : (naming = false)))}
    {:else if studioUi.renaming}
      {@render nameField(track.name, 'Track name', (name) => ((studioUi.renaming = false), name && studio.edit(() => (track.name = name))))}
    {:else}
      <button type="button" class={['truncate font-medium', docked ? 'text-lg' : 'text-2xl']} style:color onclick={() => (studioUi.renaming = true)} title="Rename track">{track.name}</button>
    {/if}
    <span class="ml-auto truncate font-mono text-xs text-muted uppercase">{presetName(track.preset)}{track.patch ? ' · edited' : ''}</span>
  </div>

  {#if kit}
    <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 p-3">
      {@render voice()}
      <div class="grid min-h-0 grid-cols-4 gap-1.5" style:grid-auto-rows="minmax(0, 1fr)">
        {#each pads as item, i (item.midi)}
          <button
            type="button"
            class={['min-h-0 cursor-pointer overflow-hidden rounded-md px-2 text-left text-xs', i === padIndex ? 'ring-2 ring-fg' : '']}
            style:background="color-mix(in srgb, {color} {item.sample ? 34 : 10}%, transparent)"
            onclick={() => ((padIndex = i), audition(item.midi))}
          >
            <span class="block truncate">{item.name}</span><span class="font-mono text-[10px] text-muted">{noteName(item.midi)}</span>
          </button>
        {/each}
      </div>
    </div>
  {:else if patch && controls}
    <SoundEditor
      {patch}
      {edit}
      {controls}
      bind:osc
      knobbed={docked ? [] : specs}
      tabs={docked ? 'top' : 'side'}
      {section}
      onsection={(id) => (docked ? (dockedSection = id) : studioUi.show('sound', SECTIONS.findIndex((s) => s.id === id)))}
      {voice}
    />
  {:else}
    <div class="grid content-start gap-2 p-3">
      {@render voice()}
      <p class="text-xs text-muted">{preset.name} plays recordings of a real instrument: pick a synth sound to shape your own.</p>
    </div>
  {/if}

  <SoftKeys
    keys={[
      kit
        ? { label: 'Load sample', onclick: () => fileInput.click(), disabled: !pad, title: 'Put an audio file on the selected pad' }
        : { label: 'Save as sound', onclick: () => (naming = true), disabled: !patch, title: 'Keep this sound in My sounds, for any track and the piano' },
      ...(kit ? [] : [{ label: 'Reset sound', onclick: () => studio.edit(() => (track.patch = undefined)), disabled: !track.patch, title: "Back to the preset's sound" }]),
      { label: 'Delete track', onclick: () => studio.removeTrack(track.id), disabled: studio.project.tracks.length <= 1 },
    ]}
  />
</div>

<input
  bind:this={fileInput}
  type="file"
  accept="audio/*"
  hidden
  onchange={(e) => {
    const file = e.currentTarget.files?.[0]
    e.currentTarget.value = ''
    if (file) void load(file)
  }}
/>
