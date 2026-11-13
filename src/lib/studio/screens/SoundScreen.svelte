<script lang="ts">
  import { DRUMS } from '../../audio/drums'
  import { engine } from '../../audio/engine.svelte'
  import type { SynthPatch } from '../../audio/patch'
  import { BUILTIN, importSample } from '../../audio/samples'
  import { sound } from '../../audio/sound.svelte'
  import { noteName } from '../../input/keymaps'
  import { choiceKnob, knobs, parseNumber, percentKnob, rangeKnob, type KnobSpec } from '../../device/knobs.svelte'
  import SoftKeys from '../../device/SoftKeys.svelte'
  import { DEFAULT_PRESET, KIT, type Track } from '../project'
  import { isKit, studio, trackChannel } from '../studio.svelte'
  import { studioUi } from '../ui.svelte'
  import { focusOnMount } from '../../ui/focus'

  /** The selected track's instrument. Synths: page 1 Voice (sound, filter, FM, level), page 2 Envelope (ADSR). Kits: pads. */
  let { track, color, page }: { track: Track; color: string; page: number } = $props()

  const AUDITION_MS = 400
  const kit = $derived(isKit(track))
  const preset = $derived(sound.find(track.preset))
  const choices = $derived([KIT, ...sound.presets.map((p) => p.id)])
  const patch = $derived<SynthPatch | null>(kit ? null : (track.patch ?? (preset.kind === 'synth' ? preset.patch : null)))
  const pads = $derived([...track.pads].sort((a, b) => a.midi - b.midi))
  const channel = $derived(trackChannel(studio.project.tracks.indexOf(track)))

  let padIndex = $state(0)
  let fileInput: HTMLInputElement
  const pad = $derived(pads[Math.min(padIndex, pads.length - 1)])

  const defaultPads = () => DRUMS.map((d) => ({ midi: d.midi, name: d.name, sample: BUILTIN + d.id }))

  function setPreset(id: string) {
    if (id === track.preset) return
    studio.tweak(() => {
      track.preset = id
      track.patch = undefined
      if (id === KIT && !track.pads.length) track.pads = defaultPads()
    })
  }

  /** Copies the preset into the track the first time a tone knob moves. */
  function tone(change: (patch: SynthPatch) => void) {
    if (preset.kind !== 'synth') return
    studio.tweak(() => {
      track.patch ??= structuredClone($state.snapshot(preset.patch))
      change(track.patch)
    })
  }

  const presetName = (id: string) => (id === KIT ? 'Drum kit' : sound.find(id).name)
  const TRACK_LEVEL = 0.8
  const FILTER_LOW = 80
  const FILTER_SPAN = 100
  const OPEN = 0.99
  const FM_OFF = 0.05
  const seconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`)
  /** "300 ms", "0.3 s", "300" (ms) or "1.5" (s, when below 10). */
  const parseSeconds = (text: string) => {
    const v = parseNumber(text)
    if (v === null) return null
    return /ms/i.test(text) || (!/s/i.test(text) && v >= 10) ? v / 1000 : v
  }
  const cutoff = (unit: number) => Math.round(FILTER_LOW * Math.pow(FILTER_SPAN, unit))
  const filterUnit = (p: SynthPatch) => (p.filter.enabled ? Math.log(p.filter.base / FILTER_LOW) / Math.log(FILTER_SPAN) : 1)
  const hz = (v: number) => (v < 1000 ? `${v} Hz` : `${(v / 1000).toFixed(1)} kHz`)
  /** A knob over one patch value; reset goes back to the preset's value. */
  const synthKnob = (label: string, min: number, max: number, read: (p: SynthPatch) => number, write: (p: SynthPatch, v: number) => void, format: (v: number) => string, parse?: (text: string) => number | null): KnobSpec | null => {
    // Knob closures outlive this patch (undo, switching to a kit); they read the one they were made for.
    const current = patch
    const original = preset.kind === 'synth' ? preset.patch : null
    return current ? rangeKnob(label, min, max, () => read(current), (v) => tone((p) => write(p, v)), format, { initial: original ? read(original) : undefined, parse }) : null
  }
  const level = () => percentKnob('Level', () => track.volume, (v) => studio.tweak(() => (track.volume = v)), TRACK_LEVEL)

  const specs = $derived.by((): (KnobSpec | null)[] => {
    const instrument = choiceKnob('Sound', choices, () => track.preset, setPreset, presetName, DEFAULT_PRESET)
    if (kit) {
      return [
        instrument,
        pads.length ? choiceKnob('Pad', pads.map((_, i) => i), () => padIndex, (i) => ((padIndex = i), audition(pads[i].midi)), (i) => pads[i]?.name ?? '', 0) : null,
        level(),
        null,
      ]
    }
    if (page === 0) {
      return [
        instrument,
        synthKnob('Filter', 0, 1, filterUnit, (p, v) => {
          p.filter.enabled = v < OPEN
          p.filter.base = cutoff(v)
        }, (v) => (v >= OPEN ? 'open' : hz(cutoff(v))), (text) => {
          if (/open|off/i.test(text)) return 1
          const v = parseNumber(text)
          return v === null ? null : Math.log(Math.max(FILTER_LOW, v) / FILTER_LOW) / Math.log(FILTER_SPAN)
        }),
        synthKnob('FM', 0, 8, (p) => (p.fm.enabled ? p.fm.index : 0), (p, v) => {
          p.fm.enabled = v > FM_OFF
          p.fm.index = v
        }, (v) => (v <= FM_OFF ? 'off' : v.toFixed(1)), (text) => (/off/i.test(text) ? 0 : parseNumber(text))),
        level(),
      ]
    }
    return [
      synthKnob('Attack', 0.001, 2, (p) => p.attack, (p, v) => (p.attack = v), seconds, parseSeconds),
      synthKnob('Decay', 0.05, 6, (p) => p.decay, (p, v) => (p.decay = v), seconds, parseSeconds),
      synthKnob('Sustain', 0, 1, (p) => p.sustain, (p, v) => (p.sustain = v), (v) => `${Math.round(v * 100)}%`, (text) => {
        const v = parseNumber(text)
        return v === null ? null : v / 100
      }),
      synthKnob('Release', 0.01, 4, (p) => p.release, (p, v) => (p.release = v), seconds, parseSeconds),
    ]
  })

  $effect(() => knobs.use(specs))

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

  /** ADSR outline across the display width. */
  const envelope = $derived.by(() => {
    if (!patch) return ''
    const total = patch.attack + patch.decay + patch.release + 0.6
    const x = (t: number) => (t / total) * 100
    const sustain = 90 - patch.sustain * 80
    return `M0 90 L${x(patch.attack)} 10 L${x(patch.attack + patch.decay)} ${sustain} L${x(patch.attack + patch.decay + 0.6)} ${sustain} L100 90`
  })
</script>

<div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]">
  <div class="flex items-baseline gap-3 px-4 pt-3">
    {#if studioUi.renaming}
      <input
        class="min-w-0 flex-1 bg-transparent text-2xl font-medium outline-none"
        value={track.name}
        aria-label="Track name"
        use:focusOnMount
        onblur={(e) => ((studioUi.renaming = false), studio.edit(() => (track.name = e.currentTarget.value.trim() || track.name)))}
        onkeydown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') ((e.currentTarget.value = track.name), e.currentTarget.blur())
        }}
      />
    {:else}
      <button type="button" class="truncate text-2xl font-medium" style:color onclick={() => (studioUi.renaming = true)} title="Rename track">{track.name}</button>
    {/if}
    <span class="ml-auto truncate font-mono text-xs text-muted uppercase">{presetName(track.preset)}{track.patch ? ' · edited' : ''}</span>
  </div>

  {#if kit}
    <div class="grid min-h-0 grid-cols-4 gap-1.5 p-3" style:grid-auto-rows="minmax(0, 1fr)">
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
  {:else if patch}
    <div class="relative min-h-0">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="absolute inset-0 size-full px-4 py-3" aria-label="Envelope">
      <path d={envelope} fill="none" stroke={color} stroke-width="2" vector-effect="non-scaling-stroke" />
      {#each patch.partials as partial, i (i)}
        <rect x={60 + i * 5} y={100 - partial.gain * 40} width="3" height={partial.gain * 40} fill={color} opacity="0.35" />
      {/each}
    </svg>
    </div>
  {:else}
    <p class="self-center px-4 text-muted">Sampled instrument: nothing to shape. Turn the blue knob for another sound.</p>
  {/if}

  <SoftKeys
    keys={[
      kit
        ? { label: 'Load sample', onclick: () => fileInput.click(), disabled: !pad, title: 'Put an audio file on the selected pad' }
        : { label: 'Reset sound', onclick: () => studio.edit(() => (track.patch = undefined)), disabled: !track.patch, title: "Back to the preset's sound" },
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
