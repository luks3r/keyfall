<script lang="ts">
  import { sound } from '../audio/sound.svelte'
  import Button from '../ui/Button.svelte'
  import Field from '../ui/Field.svelte'
  import Icon from '../ui/Icon.svelte'
  import Param from '../ui/Param.svelte'
  import Section from '../ui/Section.svelte'
  import Select, { type Option } from '../ui/Select.svelte'
  import { DRUMS } from '../audio/drums'
  import { BUILTIN } from '../audio/samples'
  import { KIT, type Track } from './project'
  import { studio } from './studio.svelte'

  let { track, onpractice }: { track: Track; onpractice: (trackIds: string[]) => void } = $props()

  const presetOptions = $derived<Option[]>([
    { value: KIT, label: 'Drum & sample pads', group: 'Pads' },
    ...sound.presets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      group: preset.id.startsWith('custom-') ? 'My presets' : preset.kind === 'synth' ? 'Synth' : 'Sampled · downloads once',
    })),
  ])

  function setPreset(preset: string) {
    studio.edit(() => {
      track.preset = preset
      if (preset === KIT && !track.pads.length) track.pads = DRUMS.map((d) => ({ midi: d.midi, name: d.name, sample: BUILTIN + d.id }))
    })
  }
</script>

<!-- Sections flow into columns as the dock widens; each new device type (plugins, effects) is one more section. -->
<div class="grid content-start gap-6 overflow-y-auto p-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
  <Section title="Track">
    <Field label="Name">
      <input
        class="h-9 rounded-lg bg-raised px-3 outline-none focus:ring-2 focus:ring-accent"
        value={track.name}
        onchange={(e) => studio.edit(() => (track.name = e.currentTarget.value.trim() || track.name))}
      />
    </Field>
    <div class="flex gap-2">
      <Button class="flex-1" onclick={() => onpractice([track.id])} title="Practise this track in Learn"><Icon name="learn" />Practise</Button>
      <Button variant="danger" onclick={() => studio.removeTrack(track.id)} disabled={studio.project.tracks.length <= 1} title="Delete track" aria-label="Delete track">
        <Icon name="trash" />
      </Button>
    </div>
  </Section>

  <Section title="Instrument">
    <Select bind:value={() => track.preset, setPreset} options={presetOptions} />
    <p class="text-xs leading-relaxed text-muted">
      The selected track is armed: your keyboard plays this instrument and <span class="text-fg">Record</span> writes into the track.
    </p>
  </Section>

  <Section title="Output">
    <Param label="Volume" bind:value={track.volume} min={0} max={1} />
    <div class="flex gap-2">
      <Button class={['flex-1', track.muted && 'bg-danger/30']} onclick={() => studio.edit(() => (track.muted = !track.muted))} aria-pressed={track.muted}>Mute</Button>
      <Button class={['flex-1', track.solo && 'bg-accent text-bg']} onclick={() => studio.edit(() => (track.solo = !track.solo))} aria-pressed={track.solo}>Solo</Button>
    </div>
  </Section>
</div>
