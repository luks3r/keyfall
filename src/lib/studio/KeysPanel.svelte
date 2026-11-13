<script lang="ts">
  import { noteName } from '../input/keymaps'
  import type { Player } from '../player.svelte'
  import Roll from '../Roll.svelte'
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import Select, { type Option } from '../ui/Select.svelte'
  import Toolbar, { type ToolItem } from '../ui/Toolbar.svelte'
  import { CHORDS, live, MAX_TRANSPOSE, NOTE_NAMES, SCALES, type ChordName, type ScaleName } from './live.svelte'

  let { player }: { player: Player } = $props()

  const settings = $derived(live.settings)
  const rootOptions: Option[] = NOTE_NAMES.map((name, i) => ({ value: String(i), label: name }))
  const scaleOptions: Option[] = Object.keys(SCALES).map((name) => ({ value: name, label: name[0].toUpperCase() + name.slice(1) }))
  const chordOptions: Option[] = Object.entries(CHORDS).map(([value, chord]) => ({ value, label: chord.label }))
  const transpose = (step: number) => (settings.transpose = Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, settings.transpose + step)))

  const items: ToolItem[] = $derived([
    { id: 'octave', label: 'Octave (↑ ↓)', priority: 9, content: octave, menu: octave },
    { id: 'transpose', label: 'Transpose', priority: 8, content: shift, menu: shift },
    { id: 'scale', label: 'Scale', priority: 7, content: scale, menu: scale },
    {
      id: 'lock',
      label: 'Lock to scale: wrong notes snap down',
      text: 'Lock',
      priority: 6,
      active: settings.lock,
      disabled: settings.scale === 'chromatic',
      onclick: () => (settings.lock = !settings.lock),
    },
    { id: 'chord', label: 'Harmony', priority: 6, content: chord, menu: chord },
    { id: 'velocity', label: 'Velocity', priority: 4, content: velocity, menu: velocity },
    { id: 'gap', spacer: true },
    { id: 'pedal', label: 'Sustain (Shift, or tap)', text: 'Ped', priority: 5, active: player.sustain, onclick: () => player.setSustain(!player.sustain) },
  ])
</script>

{#snippet octave()}
  <div class="flex items-center" title="Octave (↑ ↓)">
    <Button variant="ghost" shape="square" onclick={() => player.shift(-12)} aria-label="Octave down"><Icon name="minus" /></Button>
    <span class="min-w-[4ch] text-center text-sm tabular-nums">{noteName(player.root)}</span>
    <Button variant="ghost" shape="square" onclick={() => player.shift(12)} aria-label="Octave up"><Icon name="plus" /></Button>
  </div>
{/snippet}

{#snippet shift()}
  <div class="flex items-center" title="Transpose every played note">
    <Button variant="ghost" shape="square" onclick={() => transpose(-1)} aria-label="Transpose down"><Icon name="minus" /></Button>
    <button type="button" class="min-w-[5ch] cursor-pointer text-center text-sm tabular-nums" onclick={() => (settings.transpose = 0)} title="Reset transpose">
      {settings.transpose > 0 ? '+' : ''}{settings.transpose} st
    </button>
    <Button variant="ghost" shape="square" onclick={() => transpose(1)} aria-label="Transpose up"><Icon name="plus" /></Button>
  </div>
{/snippet}

{#snippet scale()}
  <div class="flex gap-1">
    <div class="w-16"><Select bind:value={() => String(settings.root), (v) => (settings.root = Number(v))} options={rootOptions} /></div>
    <div class="w-40"><Select bind:value={() => settings.scale, (v) => (settings.scale = v as ScaleName)} options={scaleOptions} /></div>
  </div>
{/snippet}

{#snippet chord()}
  <div class="w-32"><Select bind:value={() => settings.chord, (v) => (settings.chord = v as ChordName)} options={chordOptions} /></div>
{/snippet}

{#snippet velocity()}
  <label class="flex items-center gap-2 px-1 text-xs text-muted" title="Velocity of computer-keyboard notes">
    Vel
    <input class="w-20" type="range" min="0.1" max="1" step="0.05" bind:value={settings.velocity} aria-label="Velocity" />
    <span class="w-[3ch] tabular-nums">{Math.round(settings.velocity * 100)}</span>
  </label>
{/snippet}

<div class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
  <div class="flex border-b border-line bg-surface px-2 py-1">
    <Toolbar label="Play" {items} />
  </div>
  <Roll {player} />
</div>
