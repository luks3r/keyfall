<script lang="ts" module>
  export const WAVE_PATHS: Record<Wave, string> = {
    sine: 'M1 6C4-1 8-1 12 6s8 7 11 0',
    triangle: 'M1 6 6.5 1l11 10L23 6',
    saw: 'M1 10 12 2v8l11-8',
    square: 'M1 10V2h11v8h11V2',
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte'
  import { MediaQuery } from 'svelte/reactivity'
  import { MAX_PARTIALS, WAVES, type SynthPatch, type Wave } from './audio/patch'
  import { SECTIONS, type Edit, type PatchControls, type SoundSection } from './audio/patch-controls'
  import Control from './device/Control.svelte'
  import { KNOB_COLORS, type KnobSpec } from './device/knobs.svelte'

  /**
   * A synth patch laid out in sections: Voice (from the owner, plus gain and key decay), oscillators, envelope,
   * filter and FM. Every value is a control you drag, scroll or tap open. Values the device knobs turn right now
   * (`knobbed`) wear their knob's colour.
   */
  let {
    patch,
    edit,
    controls,
    section,
    onsection,
    osc = $bindable(0),
    knobbed = [],
    tabs = 'side',
    voice,
  }: {
    patch: SynthPatch
    edit: Edit
    controls: PatchControls
    section: SoundSection
    onsection: (section: SoundSection) => void
    osc?: number
    knobbed?: (KnobSpec | null)[]
    tabs?: 'side' | 'top'
    voice: Snippet
  } = $props()

  const narrow = new MediaQuery('max-width: 639px')
  const side = $derived(tabs === 'side' && !narrow.current)
  const tint = (spec: KnobSpec) => {
    const i = knobbed.indexOf(spec)
    return i < 0 ? undefined : `var(--color-knob-${KNOB_COLORS[i]})`
  }

  const envelope = $derived.by(() => {
    const total = patch.attack + patch.decay + patch.release + 0.6
    const x = (t: number) => (t / total) * 100
    const sustain = 36 - patch.sustain * 32
    return `M0 36L${x(patch.attack)} 4L${x(patch.attack + patch.decay)} ${sustain}L${x(patch.attack + patch.decay + 0.6)} ${sustain}L100 36`
  })

  function addOscillator() {
    edit((p) => {
      const last = p.partials.at(-1)
      p.partials.push({ ratio: (last?.ratio ?? 0) + 1, wave: 'sine', gain: 0.2, detune: 0 })
    })
    osc = patch.partials.length - 1
  }

  function removeOscillator(i: number) {
    edit((p) => p.partials.splice(i, 1))
    osc = Math.min(osc, patch.partials.length - 1)
  }
</script>

{#snippet field(spec: KnobSpec)}
  <Control {spec} color={tint(spec)} />
{/snippet}

{#snippet stage(label: string, on: boolean, flip: () => void)}
  <button type="button" class={['h-9 w-fit rounded-md px-3 font-mono text-[11px] tracking-wider uppercase', on ? 'bg-fg text-bg' : 'bg-raised text-muted hover:bg-hover']} aria-pressed={on} onclick={flip}>{label} {on ? 'on' : 'off'}</button>
{/snippet}

<div class={['grid min-h-0', side ? 'grid-cols-[7.5rem_minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]']}>
  <div class={['flex gap-0.5 p-1.5', side ? 'flex-col border-r border-line' : 'overflow-x-auto [scrollbar-width:none]']} role="tablist" aria-orientation={side ? 'vertical' : 'horizontal'} aria-label="Sound sections">
    {#each SECTIONS as item (item.id)}
      <button
        type="button"
        role="tab"
        aria-selected={section === item.id}
        class={['h-9 shrink-0 rounded px-3 text-left uppercase', section === item.id ? 'bg-raised text-fg' : 'text-muted hover:text-fg']}
        onclick={() => onsection(item.id)}>{item.label}</button
      >
    {/each}
  </div>

  <div class="grid min-h-0 content-start gap-2 overflow-y-auto p-3" role="tabpanel" aria-label={SECTIONS.find((s) => s.id === section)?.label}>
    {#if section === 'voice'}
      {@render voice()}
      <div class="grid grid-cols-2 gap-2">
        {@render field(controls.gain)}
        {@render field(controls.keyTrack)}
      </div>
      <p class="text-xs text-muted">Key decay: higher notes fade sooner, as on a real piano.</p>
    {:else if section === 'osc'}
      {#each patch.partials as partial, i (i)}
        {@const c = controls.oscillators[i]}
        <div
          class={['grid gap-2 rounded-md border p-2', i === osc ? 'border-fg/60' : 'border-line']}
          role="group"
          aria-label="Oscillator {i + 1}"
          onpointerdowncapture={() => (osc = i)}
          onfocusin={() => (osc = i)}
        >
          <div class="flex items-center gap-1">
            <span class="w-12 font-mono text-[10px] tracking-wider text-muted uppercase">Osc {i + 1}</span>
            <div class="flex flex-1 gap-1" role="radiogroup" aria-label="Wave">
              {#each WAVES as wave (wave)}
                <button
                  type="button"
                  role="radio"
                  aria-checked={partial.wave === wave}
                  aria-label={wave}
                  title={wave}
                  class={['grid h-9 flex-1 place-items-center rounded', partial.wave === wave ? 'bg-fg text-bg' : 'bg-raised hover:bg-hover']}
                  onclick={() => edit((p) => (p.partials[i].wave = wave))}
                >
                  <svg viewBox="0 0 24 12" class="h-3 w-7 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.8]" aria-hidden="true"><path d={WAVE_PATHS[wave]} /></svg>
                </button>
              {/each}
            </div>
            <button type="button" class="grid size-9 place-items-center rounded text-muted hover:bg-raised hover:text-fg disabled:opacity-30" disabled={patch.partials.length <= 1} onclick={() => removeOscillator(i)} aria-label="Remove oscillator {i + 1}" title="Remove">×</button>
          </div>
          {#if c}
            <div class="grid grid-cols-3 gap-2">
              {@render field(c.ratio)}
              {@render field(c.level)}
              {@render field(c.detune)}
            </div>
          {/if}
        </div>
      {/each}
      <button type="button" class="h-11 rounded-md border border-dashed border-line font-mono text-[11px] tracking-wider text-muted uppercase hover:text-fg disabled:opacity-30" disabled={patch.partials.length >= MAX_PARTIALS} onclick={addOscillator}>+ Oscillator</button>
    {:else if section === 'env'}
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" class="h-16 w-full" aria-hidden="true">
        <path d={envelope} fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {@render field(controls.attack)}
        {@render field(controls.decay)}
        {@render field(controls.sustain)}
        {@render field(controls.release)}
      </div>
    {:else if section === 'filter'}
      {@render stage('Filter', patch.filter.enabled, () => edit((p) => (p.filter.enabled = !p.filter.enabled)))}
      <div class={['grid grid-cols-2 gap-2 sm:grid-cols-4', !patch.filter.enabled && 'opacity-60']}>
        {@render field(controls.cutoff)}
        {@render field(controls.filterEnv)}
        {@render field(controls.filterDecay)}
        {@render field(controls.keyFollow)}
      </div>
      <p class="text-xs text-muted">Moving any filter value turns the filter on.</p>
    {:else}
      {@render stage('FM', patch.fm.enabled, () => edit((p) => (p.fm.enabled = !p.fm.enabled)))}
      <div class={['grid grid-cols-3 gap-2', !patch.fm.enabled && 'opacity-60']}>
        {@render field(controls.fmDepth)}
        {@render field(controls.fmRatio)}
        {@render field(controls.fmDecay)}
      </div>
      <p class="text-xs text-muted">FM bends each note with a second wave: depth adds bite, decay makes it a pluck.</p>
    {/if}
  </div>
</div>
