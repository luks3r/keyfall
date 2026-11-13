<script lang="ts">
  import { MAX_PARTIALS, WAVES } from './audio/patch'
  import { sound } from './audio/sound.svelte'
  import Button from './ui/Button.svelte'
  import Icon from './ui/Icon.svelte'
  import Panel from './ui/Panel.svelte'
  import Param from './ui/Param.svelte'
  import Section from './ui/Section.svelte'
  import Select, { type Option } from './ui/Select.svelte'
  import Toggle from './ui/Toggle.svelte'

  let { onclose }: { onclose: () => void } = $props()

  let naming = $state<'new' | 'rename' | null>(null)
  let name = $state('')

  const patch = $derived(sound.patch)
  const presetOptions = $derived<Option[]>(
    sound.presets.map((preset) => ({
      value: preset.id,
      label: preset.name,
      group: preset.id.startsWith('custom-') ? 'My presets' : preset.kind === 'synth' ? 'Synth' : 'Sampled',
    })),
  )
  const waveOptions: Option[] = WAVES.map((wave) => ({ value: wave, label: wave }))

  function startNaming(kind: 'new' | 'rename') {
    naming = kind
    name = kind === 'rename' ? sound.preset.name : `${sound.preset.name} copy`
  }

  function commitName() {
    if (naming === 'new') sound.saveAs(name)
    else if (naming === 'rename') sound.rename(name)
    naming = null
  }

  function addPartial() {
    const last = patch.partials.at(-1)
    patch.partials.push({ ratio: (last?.ratio ?? 0) + 1, wave: 'sine', gain: 0.2, detune: 0 })
  }
</script>

<Panel title="Synth" modal={false} width={380} {onclose}>
  <Section title="Preset">
    {#snippet aside()}
      {#if sound.modified}<span class="text-xs text-accent">modified</span>{/if}
    {/snippet}
    <Select bind:value={() => sound.presetId, (id) => sound.select(id)} options={presetOptions} />

    {#if naming}
      <form
        class="flex gap-2"
        onsubmit={(e) => {
          e.preventDefault()
          commitName()
        }}
      >
        <!-- svelte-ignore a11y_autofocus -->
        <input
          bind:value={name}
          autofocus
          aria-label="Preset name"
          class="h-8 min-w-0 flex-1 rounded-lg bg-raised px-2.5 outline-none focus:ring-1 focus:ring-accent"
          onkeydown={(e) => e.code === 'Escape' && (e.stopPropagation(), (naming = null))}
        />
        <Button type="submit" variant="accent">{naming === 'new' ? 'Create' : 'Rename'}</Button>
      </form>
    {:else if sound.preset.kind === 'synth'}
      <div class="flex flex-wrap gap-2">
        {#if sound.isCustom}
          <Button onclick={() => sound.save()} disabled={!sound.modified}>Save</Button>
        {/if}
        <Button onclick={() => startNaming('new')}>Save as…</Button>
        <Button onclick={() => sound.reset()} disabled={!sound.modified}>Revert</Button>
        {#if sound.isCustom}
          <Button onclick={() => startNaming('rename')}>Rename</Button>
          <Button variant="danger" onclick={() => sound.remove()}>Delete</Button>
        {/if}
      </div>
    {/if}
  </Section>

  {#if sound.preset.kind === 'sampled'}
    <p class="text-xs text-muted">Sampled instruments play recordings. Pick a synth preset to shape the sound.</p>
  {:else}
    <Section title="Envelope">
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <Param label="Attack" bind:value={patch.attack} min={0.001} max={2} log unit="s" />
        <Param label="Decay" bind:value={patch.decay} min={0.05} max={8} log unit="s" />
        <Param label="Sustain" bind:value={patch.sustain} min={0} max={1} />
        <Param label="Release" bind:value={patch.release} min={0.01} max={4} log unit="s" />
        <Param label="Level" bind:value={patch.gain} min={0} max={1.5} />
        <div class="self-end pb-1"><Toggle label="Key tracking" bind:checked={patch.keyTrack} /></div>
      </div>
    </Section>

    <Section title="Filter">
      {#snippet aside()}<Toggle label="" bind:checked={patch.filter.enabled} />{/snippet}
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <Param label="Cutoff" bind:value={patch.filter.base} min={20} max={8000} log unit=" Hz" disabled={!patch.filter.enabled} />
        <Param label="Key follow" bind:value={patch.filter.track} min={0} max={8} disabled={!patch.filter.enabled} />
        <Param label="Envelope" bind:value={patch.filter.env} min={0} max={8} disabled={!patch.filter.enabled} />
        <Param label="Env decay" bind:value={patch.filter.decay} min={0.05} max={8} log unit="s" disabled={!patch.filter.enabled} />
      </div>
    </Section>

    <Section title="FM">
      {#snippet aside()}<Toggle label="" bind:checked={patch.fm.enabled} />{/snippet}
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <Param label="Ratio" bind:value={patch.fm.ratio} min={0.25} max={16} step={0.25} disabled={!patch.fm.enabled} />
        <Param label="Depth" bind:value={patch.fm.index} min={0} max={10} step={0.05} disabled={!patch.fm.enabled} />
        <Param label="Decay" bind:value={patch.fm.decay} min={0.02} max={4} log unit="s" disabled={!patch.fm.enabled} />
      </div>
    </Section>

    <Section title="Oscillators">
      {#snippet aside()}
        <Button variant="ghost" shape="square" onclick={addPartial} disabled={patch.partials.length >= MAX_PARTIALS} aria-label="Add oscillator" title="Add oscillator">
          <Icon name="plus" />
        </Button>
      {/snippet}
      {#each patch.partials as partial, i (i)}
        <div class="grid gap-2 rounded-xl bg-bg/60 p-3">
          <div class="flex items-center gap-2">
            <div class="flex-1"><Select bind:value={partial.wave} options={waveOptions} /></div>
            <Button variant="ghost" shape="square" onclick={() => patch.partials.splice(i, 1)} disabled={patch.partials.length <= 1} aria-label="Remove oscillator">
              <Icon name="minus" />
            </Button>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-3">
            <Param label="Ratio" bind:value={partial.ratio} min={0.25} max={16} step={0.25} />
            <Param label="Level" bind:value={partial.gain} min={0} max={1} />
            <Param label="Detune" bind:value={partial.detune} min={-50} max={50} step={1} unit="¢" />
          </div>
        </div>
      {/each}
    </Section>
  {/if}
</Panel>
