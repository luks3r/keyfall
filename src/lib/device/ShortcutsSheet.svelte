<script lang="ts">
  import Panel from '../ui/Panel.svelte'
  import { formatKeys, shortcuts } from './shortcuts.svelte'

  /** Every key the current screen answers to, newest layer first, plus the mouse gestures that work everywhere. */
  let { onclose }: { onclose: () => void } = $props()

  const MOUSE = [
    ['Knob', 'drag up/down to turn, Shift-drag for fine, scroll for steps'],
    ['Knob', 'double-click, Alt-click or Delete resets; Enter, typing or a click on its value types one'],
    ['Knob', 'right-click to reset, type a value or learn a MIDI knob'],
    ['Step grid', 'click a step to add it, drag to lengthen (drums: paint); click it again to remove'],
    ['Step grid', 'drag a step up/down for velocity; right-click or right-drag erases'],
    ['Notes', 'click to add, drag to move, drag the right edge to resize, Alt-drag copies'],
    ['Notes', 'drag on empty space to select; double-click or right-click a note deletes it; ⌘/Ctrl-scroll zooms'],
    ['Clips', 'tap to launch; double-click an empty cell to start a pattern; right-click or hold to edit'],
    ['Song', 'double-click a lane for a new clip; drag clips to move, their edge to resize; right-click for more'],
  ]

  const groups = $derived([...shortcuts.groups].reverse().filter((g) => g.items.length))
</script>

<Panel title="Shortcuts" width={420} {onclose}>
  <div class="grid gap-5 text-sm">
    {#each groups as group (group)}
      <section class="grid gap-1.5">
        <h3 class="font-mono text-[11px] tracking-wider text-muted uppercase">{group.title}</h3>
        {#each group.items as item (item.label)}
          <div class="flex items-baseline justify-between gap-3">
            <span class="min-w-0">{item.label}</span>
            <span class="flex shrink-0 gap-1">
              {#each item.keys as combo (combo)}<kbd class="rounded bg-raised px-1.5 py-0.5 font-mono text-xs">{formatKeys(combo)}</kbd>{/each}
            </span>
          </div>
        {/each}
      </section>
    {/each}
    <section class="grid gap-1.5">
      <h3 class="font-mono text-[11px] tracking-wider text-muted uppercase">Mouse and touch</h3>
      {#each MOUSE as [where, what], i (i)}
        <div class="flex gap-3"><span class="w-20 shrink-0 text-muted">{where}</span><span class="min-w-0">{what}</span></div>
      {/each}
    </section>
  </div>
</Panel>
