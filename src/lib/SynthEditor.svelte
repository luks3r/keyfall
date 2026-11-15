<script lang="ts">
  import { patchControls, type SoundSection } from './audio/patch-controls'
  import { presetGroup, sound } from './audio/sound.svelte'
  import Control from './device/Control.svelte'
  import { choiceKnob } from './device/knobs.svelte'
  import SoundEditor from './SoundEditor.svelte'
  import Button from './ui/Button.svelte'
  import { focusOnMount } from './ui/focus'
  import Panel from './ui/Panel.svelte'

  /**
   * The piano's sound, beside the keys: pick an instrument, shape it while you play, keep it as your own. A panel,
   * or `docked` in the desktop inspector.
   */
  let { onclose, docked = false }: { onclose?: () => void; docked?: boolean } = $props()

  let naming = $state<'new' | 'rename' | null>(null)
  let name = $state('')
  let section = $state<SoundSection>('voice')
  let osc = $state(0)

  const synth = $derived(sound.preset.kind === 'synth' ? sound.preset.patch : null)
  const instrument = $derived(choiceKnob('Instrument', sound.presets.map((p) => p.id), () => sound.presetId, (id) => sound.select(id), (id) => sound.find(id).name, undefined, (id) => presetGroup(sound.find(id))))
  const controls = $derived(patchControls(sound.patch, synth, (change) => change(sound.patch)))

  function startNaming(kind: 'new' | 'rename') {
    naming = kind
    name = kind === 'rename' ? sound.preset.name : `${sound.preset.name} copy`
  }

  function commitName() {
    if (naming === 'new') sound.saveAs(name)
    else if (naming === 'rename') sound.rename(name)
    naming = null
  }
</script>

{#snippet voice()}
  <Control spec={instrument} />
  {#if naming}
    <form
      class="flex gap-2"
      onsubmit={(e) => {
        e.preventDefault()
        commitName()
      }}
    >
      <input
        bind:value={name}
        use:focusOnMount
        aria-label="Sound name"
        class="h-9 min-w-0 flex-1 rounded bg-raised px-2.5 outline-none focus:ring-1 focus:ring-fg"
        onkeydown={(e) => e.key === 'Escape' && (e.stopPropagation(), (naming = null))}
      />
      <Button type="submit" variant="accent">{naming === 'new' ? 'Save' : 'Rename'}</Button>
    </form>
  {:else if synth}
    <div class="flex flex-wrap gap-1.5">
      {#if sound.isCustom}<Button onclick={() => sound.save()} disabled={!sound.modified}>Save</Button>{/if}
      <Button onclick={() => startNaming('new')}>Save as…</Button>
      <Button onclick={() => sound.reset()} disabled={!sound.modified}>Revert</Button>
      {#if sound.isCustom}
        <Button onclick={() => startNaming('rename')}>Rename</Button>
        <Button variant="danger" onclick={() => sound.remove()}>Delete</Button>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet body()}
  {#if synth}
    <div class={['grid min-h-0', !docked && '-mx-5 -my-3']}>
      <SoundEditor patch={sound.patch} edit={(change) => change(sound.patch)} {controls} {section} onsection={(id) => (section = id)} bind:osc tabs="top" {voice} />
    </div>
  {:else}
    <div class={['grid content-start gap-2', docked && 'p-3']}>
      {@render voice()}
      <p class="text-xs text-muted">{sound.preset.name} plays recordings of a real piano: pick a synth sound to shape your own.</p>
    </div>
  {/if}
{/snippet}

{#if docked}
  <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
    <h2 class="truncate px-4 pt-3 pb-1 text-lg font-medium">Sound{sound.modified ? ' · edited' : ''}</h2>
    {@render body()}
  </div>
{:else}
  <Panel title="Sound{sound.modified ? ' · edited' : ''}" modal={false} width={420} onclose={() => onclose?.()}>
    {@render body()}
  </Panel>
{/if}
