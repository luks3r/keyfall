<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import { focusedByKeyboard } from '../input/focus'
  import { controls } from '../studio/controls.svelte'
  import Button from '../ui/Button.svelte'
  import Menu from '../ui/Menu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import { enter, nudge, reset, setTo, type KnobOption, type KnobSpec } from './knob-specs'

  /**
   * A control opened up: choices as a list; numbers as a big slider with − and + steps and a field to type in.
   * Reset and MIDI learn sit at the bottom. `knob` is the device knob it belongs to, for MIDI learn.
   */
  let {
    spec,
    anchor,
    knob,
    draft = null,
    extra,
    onclose,
  }: { spec: KnobSpec; anchor: HTMLElement; knob?: number; draft?: string | null; extra?: Snippet; onclose: () => void } = $props()

  /** A mouse or keyboard user types; a finger gets the slider and no surprise on-screen keyboard. */
  const opening = untrack(() => draft)
  const typeFirst = opening !== null || focusedByKeyboard() || matchMedia('(pointer: fine)').matches

  let text = $state<string | null>(opening)
  let invalid = $state(false)
  const cc = $derived(knob === undefined ? null : (controls.knobCCs[knob] ?? null))

  const groups = $derived.by(() => {
    const map = new Map<string, KnobOption[]>()
    for (const option of spec.options ?? []) map.set(option.group ?? '', [...(map.get(option.group ?? '') ?? []), option])
    return [...map]
  })
  const current = $derived(spec.value())

  function commit(close: boolean) {
    if (text === null) return close && onclose()
    invalid = !enter(spec, text)
    if (invalid) return
    text = null
    if (close) onclose()
  }

  function field(node: HTMLInputElement) {
    if (opening !== null) queueMicrotask(() => node.setSelectionRange(node.value.length, node.value.length))
  }
</script>

<Menu {anchor} returnFocus={anchor} {onclose}>
  <div class="flex items-baseline justify-between gap-4 px-2 pt-1 pb-1.5" tabindex="-1" data-autofocus={typeFirst ? undefined : ''}>
    <span class="font-mono text-[10px] tracking-wider text-muted uppercase">{spec.label}</span>
    {#if spec.options}<span class="truncate font-mono text-xs">{spec.display()}</span>{/if}
  </div>

  {#if spec.options}
    {#each groups as [group, list] (group)}
      {#if group}<div class="px-3 pt-2 pb-0.5 font-mono text-[10px] tracking-wider text-muted uppercase">{group}</div>{/if}
      {#each list as option (option.value)}
        {@const selected = Math.abs(option.value - current) < 1e-6}
        <MenuItem radio checked={selected} autofocus={selected} onclick={() => (setTo(spec, option.value), onclose())}>{option.label}</MenuItem>
      {/each}
    {/each}
  {:else}
    <input
      class={['mx-1 h-11 rounded bg-raised px-3 font-mono text-lg tabular-nums outline-none focus:ring-1 focus:ring-fg', invalid && 'ring-1 ring-danger']}
      value={text ?? spec.display()}
      aria-label="{spec.label} value"
      aria-invalid={invalid}
      inputmode="decimal"
      enterkeyhint="done"
      disabled={!spec.parse}
      data-autofocus={typeFirst ? '' : undefined}
      use:field
      onfocus={(e) => opening === null && e.currentTarget.select()}
      oninput={(e) => ((text = e.currentTarget.value), (invalid = false))}
      onkeydown={(e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        e.stopPropagation()
        commit(true)
      }}
      onblur={() => commit(false)}
    />
    <div class="flex items-center gap-1 px-1 pt-2 pb-1">
      <Button shape="square" class="text-lg" aria-label="Down one step" onclick={() => ((text = null), nudge(spec, -1))}>−</Button>
      <input
        type="range"
        class="h-11 min-w-0 flex-1"
        min="0"
        max="1"
        step="0.001"
        value={current}
        aria-label={spec.label}
        aria-valuetext={spec.display()}
        oninput={(e) => ((text = null), setTo(spec, e.currentTarget.valueAsNumber))}
      />
      <Button shape="square" class="text-lg" aria-label="Up one step" onclick={() => ((text = null), nudge(spec, 1))}>+</Button>
    </div>
  {/if}

  {@render extra?.()}

  {#if spec.initial !== undefined || knob !== undefined}
    <hr class="my-1 border-line" />
    {#if spec.initial !== undefined}
      <MenuItem onclick={() => reset(spec)}>Reset</MenuItem>
    {/if}
    {#if knob !== undefined}
      {#if controls.learnKnob === knob}
        <MenuItem onclick={() => (controls.learnKnob = null)}>Cancel MIDI learn</MenuItem>
      {:else}
        <MenuItem onclick={() => (controls.learnKnob = knob)}>Learn MIDI knob{cc === null ? '' : ` (now CC ${cc})`}</MenuItem>
      {/if}
      {#if cc !== null}
        <MenuItem onclick={() => controls.forgetKnob(knob)}>Forget CC {cc}</MenuItem>
      {/if}
    {/if}
  {/if}
</Menu>
