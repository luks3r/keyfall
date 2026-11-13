<script lang="ts">
  import { onMount } from 'svelte'
  import type { ThemePreference } from './theme'
  import { engine } from './audio/engine.svelte'
  import { sound } from './audio/sound.svelte'
  import { KEYMAPS } from './input/keymaps'
  import type { MidiPorts } from './input/midi.svelte'
  import { platform, type Device } from './platform'
  import { AUDIO_OFF, CUSTOM_KEYMAP, MAX_TRANSPOSE, RANGE_AUTO, RANGE_FULL, settings } from './settings.svelte'
  import Calibrate from './Calibrate.svelte'
  import Button from './ui/Button.svelte'
  import Field from './ui/Field.svelte'
  import Icon from './ui/Icon.svelte'
  import Panel from './ui/Panel.svelte'
  import Param from './ui/Param.svelte'
  import Section from './ui/Section.svelte'
  import Select, { type Option } from './ui/Select.svelte'
  import Toggle from './ui/Toggle.svelte'

  let { midi, onclose, onsynth, onshortcuts }: { midi: MidiPorts; onclose: () => void; onsynth: () => void; onshortcuts: () => void } = $props()

  const NONE = ''
  const SOUND_HINT = { loading: 'Loading…', ready: '', error: 'Failed to load' }
  const MIN_OCTAVES = 2
  const MAX_OCTAVES = 7

  let audioOutputs = $state.raw<Device[]>([])
  const bufferOptions: Option[] = [64, 128, 256, 512].map((frames) => ({
    value: String(frames),
    label: `${frames} frames${frames === 64 ? ' · lowest, may crackle' : frames === 512 ? ' · safest' : ''}`,
  }))

  const devices = (list: Device[], current: string | null): Option[] => {
    const options = list.map(({ id, name }) => ({ value: id, label: name }))
    if (current && !list.some((device) => device.id === current)) options.push({ value: current, label: `${current} (missing)` })
    return options
  }

  const soundOptions = $derived<Option[]>(
    sound.presets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      group: preset.id.startsWith('custom-') ? 'My presets' : preset.kind === 'synth' ? 'Synth' : 'Sampled · downloads once',
    })),
  )
  const keymapOptions: Option[] = [...KEYMAPS.map((keymap) => ({ value: keymap.id, label: keymap.name })), { value: CUSTOM_KEYMAP, label: 'Custom' }]
  const rangeOptions: Option[] = [
    { value: RANGE_AUTO, label: 'Auto · fit keys and song' },
    ...Array.from({ length: MAX_OCTAVES - MIN_OCTAVES + 1 }, (_, i) => ({ value: String(MIN_OCTAVES + i), label: `${MIN_OCTAVES + i} octaves` })),
    { value: RANGE_FULL, label: '88 keys' },
  ]
  const keymapDescription = $derived(KEYMAPS.find((keymap) => keymap.id === settings.keymapId)?.description ?? 'Your own bindings.')
  const audioOptions = $derived<Option[]>([
    { value: NONE, label: 'System default' },
    ...devices(audioOutputs, settings.audioOutput === AUDIO_OFF ? null : settings.audioOutput),
    { value: AUDIO_OFF, label: 'Off · MIDI only' },
  ])
  const midiInputOptions = $derived<Option[]>([{ value: NONE, label: 'None' }, ...devices(midi.inputs, settings.midiInput)])
  const midiOutputOptions = $derived<Option[]>([{ value: NONE, label: 'None' }, ...devices(midi.outputs, settings.midiOutput)])

  const transpose = (step: number) => {
    settings.transpose = Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, settings.transpose + step))
  }

  async function refresh() {
    audioOutputs = await platform.audio.outputs().catch(() => [])
    if (midi.enabled) await midi.refresh().catch(() => {})
  }

  function edit() {
    settings.startEditing()
    onclose()
  }

  onMount(() => {
    void refresh()
  })
</script>

<Panel title="Settings" {onclose}>
  {#snippet actions()}
    <Button variant="ghost" shape="square" onclick={refresh} title="Rescan devices" aria-label="Rescan devices"><Icon name="refresh" /></Button>
  {/snippet}

  <Section title="Appearance">
    <Field label="Theme">
      <Select bind:value={() => settings.theme, (v) => (settings.theme = v as ThemePreference)} options={[{value:'system',label:'System'},{value:'light',label:'Light · OP-1'},{value:'dark',label:'Dark · OP-XY'}]} />
    </Field>
  </Section>
  <Section title="Sound">
    <Field label="Instrument" hint={SOUND_HINT[engine.status]} tone={engine.status === 'error' ? 'danger' : 'accent'}>
      <Select bind:value={() => sound.presetId, (id) => sound.select(id)} options={soundOptions} />
    </Field>
    <Button onclick={onsynth}><Icon name="wave" />Edit synth</Button>
    <Param label="Volume" bind:value={settings.volume} min={0} max={1} />
  </Section>

  <Section title="Keyboard">
    <Field label="Keymap">
      <Select bind:value={settings.keymapId} options={keymapOptions} />
    </Field>
    <p class="-mt-1.5 text-xs leading-relaxed text-muted">{keymapDescription}</p>
    <div class="flex gap-2">
      <Button class="flex-1" onclick={edit}>{settings.keymapId === CUSTOM_KEYMAP ? 'Edit keys' : 'Customize'}</Button>
      {#if settings.keymapId === CUSTOM_KEYMAP}
        <Button class="flex-1" onclick={() => settings.resetCustom()}>Reset</Button>
      {/if}
    </div>
    <Button onclick={onshortcuts}>Keyboard shortcuts</Button>
    <div class="flex items-center justify-between text-xs text-muted">
      Transpose
      <div class="flex items-center">
        <Button variant="ghost" shape="square" onclick={() => transpose(-1)} aria-label="Transpose down"><Icon name="minus" /></Button>
        <span class="min-w-[4ch] text-center text-sm text-fg tabular-nums">{settings.transpose > 0 ? '+' : ''}{settings.transpose}</span>
        <Button variant="ghost" shape="square" onclick={() => transpose(1)} aria-label="Transpose up"><Icon name="plus" /></Button>
      </div>
    </div>
  </Section>

  <Section title="Piano view">
    <Field label="Visible keys">
      <Select bind:value={settings.range} options={rangeOptions} />
    </Field>
    <Param label="Fall time" bind:value={settings.lookahead} min={1} max={8} step={0.5} unit="s" />
    <Toggle label="Key labels" bind:checked={settings.labels} />
  </Section>

  <Section title="Output">
    <Field
      label="Audio device"
      hint={settings.outputError || (platform.audio.canSelectOutput ? '' : 'Browser uses system output')}
      tone={settings.outputError ? 'danger' : 'muted'}
    >
      <Select bind:value={() => settings.audioOutput ?? NONE, (value) => (settings.audioOutput = value || null)} options={audioOptions} />
    </Field>
    {#if platform.audio.canSetBuffer}
      <Field label="Audio buffer" hint={engine.latency === null ? '' : `${engine.latency.toFixed(1)} ms to speaker`} tone="accent">
        <Select bind:value={() => String(settings.audioBuffer), (value) => (settings.audioBuffer = Number(value))} options={bufferOptions} />
      </Field>
    {:else if engine.latency !== null}
      <p class="flex justify-between text-xs text-muted">Output latency <span class="text-accent tabular-nums">{engine.latency.toFixed(1)} ms</span></p>
    {/if}
    <Calibrate />
    <Field label="MIDI out">
      <Select bind:value={() => settings.midiOutput ?? NONE, (value) => midi.setOutput(value || null)} options={midiOutputOptions} disabled={!midi.enabled} />
    </Field>
  </Section>

  <Section title="MIDI input">
    <Field label="Device">
      <Select bind:value={() => settings.midiInput ?? NONE, (value) => midi.setInput(value || null)} options={midiInputOptions} disabled={!midi.enabled} />
    </Field>
    {#if !midi.supported}
      <p class="text-xs text-muted">This browser has no Web MIDI. Use Chrome, Edge, Firefox or the desktop app.</p>
    {:else if !midi.enabled}
      <Button variant="accent" onclick={() => midi.enable()}>Enable MIDI devices</Button>
    {/if}
    {#if midi.error}
      <p class="text-xs text-danger">{midi.error}</p>
    {/if}
  </Section>
</Panel>
