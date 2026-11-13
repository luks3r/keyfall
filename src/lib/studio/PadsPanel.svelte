<script lang="ts">
  import { noteName } from '../input/keymaps'
  import type { Player } from '../player.svelte'
  import type { Pad, Track } from './project'

  /** A kit track's pads in place of the keyboard. Samples are loaded on the Sound screen. */
  let { player, track, color }: { player: Player; track: Track; color: string } = $props()

  const COLUMNS = 4

  /** Rows bottom-up, as on hardware pad controllers: the lowest note sits bottom-left. */
  const rows = $derived.by(() => {
    const pads = [...track.pads].sort((a, b) => a.midi - b.midi)
    const result: Pad[][] = []
    for (let i = 0; i < pads.length; i += COLUMNS) result.unshift(pads.slice(i, i + COLUMNS))
    return result
  })
  const pressed = new Set<number>()

  function hit(e: PointerEvent, pad: Pad) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pressed.add(e.pointerId)
    player.press(pad.midi)
  }

  function lift(e: PointerEvent, pad: Pad) {
    if (!pressed.delete(e.pointerId)) return
    player.release(pad.midi)
  }
</script>

<div class="grid min-h-0 gap-1.5 p-2" style:grid-template-rows="repeat({rows.length}, minmax(0, 1fr))" role="group" aria-label="Pads">
  {#each rows as row, r (r)}
    <div class="grid gap-1.5" style:grid-template-columns="repeat({COLUMNS}, minmax(0, 1fr))">
      {#each row as pad (pad.midi)}
        <button
          type="button"
          class="flex min-h-0 cursor-pointer touch-none flex-col items-start justify-between overflow-hidden rounded-lg px-2 py-1 text-left text-xs leading-tight select-none active:brightness-150"
          style:background="{color}{pad.sample ? '40' : '14'}"
          onpointerdown={(e) => hit(e, pad)}
          onpointerup={(e) => lift(e, pad)}
          onpointercancel={(e) => lift(e, pad)}
          onlostpointercapture={(e) => lift(e, pad)}
          oncontextmenu={(e) => e.preventDefault()}
        >
          <span class="w-full truncate font-medium text-fg">{pad.name}</span>
          <span class="text-muted">{noteName(pad.midi)}</span>
        </button>
      {/each}
    </div>
  {/each}
</div>
