<script lang="ts">
  import { DRUMS } from '../audio/drums'
  import { BUILTIN, importSample } from '../audio/samples'
  import { noteName } from '../input/keymaps'
  import type { Player } from '../player.svelte'
  import Button from '../ui/Button.svelte'
  import Icon from '../ui/Icon.svelte'
  import { KIT, type Pad, type Track } from './project'
  import { isKit, studio } from './studio.svelte'

  let { player, track, color }: { player: Player; track: Track; color: string } = $props()

  const COLUMNS = 4

  let editing = $state(false)
  let error = $state('')
  let target: Pad | null = null
  let fileInput: HTMLInputElement

  /** Rows bottom-up, as on hardware pad controllers: the lowest note sits bottom-left. */
  const rows = $derived.by(() => {
    const pads = [...track.pads].sort((a, b) => a.midi - b.midi)
    const result: Pad[][] = []
    for (let i = 0; i < pads.length; i += COLUMNS) result.unshift(pads.slice(i, i + COLUMNS))
    return result
  })
  const pressed = new Set<number>()

  const defaultPads = (): Pad[] => DRUMS.map((drum) => ({ midi: drum.midi, name: drum.name, sample: BUILTIN + drum.id }))

  function hit(e: PointerEvent, pad: Pad) {
    e.preventDefault()
    if (editing) {
      target = pad
      return fileInput.click()
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pressed.add(e.pointerId)
    player.press(pad.midi)
  }

  function lift(e: PointerEvent, pad: Pad) {
    if (!pressed.delete(e.pointerId)) return
    player.release(pad.midi)
  }

  async function load(file: File) {
    const pad = target
    if (!pad) return
    try {
      const key = await importSample(file)
      studio.edit(() => {
        pad.sample = key
        pad.name = file.name.replace(/\.[^.]+$/, '')
      })
      error = ''
    } catch {
      error = `Can't read ${file.name}`
    }
  }
</script>

{#if !isKit(track)}
  <div class="grid content-center justify-items-center gap-3 p-6 text-center text-muted">
    <p>{track.name} plays a synth. Pads need a drum or sample kit.</p>
    <Button variant="accent" onclick={() => studio.edit(() => ((track.preset = KIT), (track.pads = defaultPads())))}><Icon name="pads" />Use a drum kit</Button>
  </div>
{:else}
  <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 p-2">
    <div class="flex items-center gap-2 text-xs text-muted">
      <span class="truncate">{editing ? 'Tap a pad to load a sample (WAV, MP3, OGG, FLAC)' : 'Tap pads to play; record with the transport'}</span>
      {#if error}<span class="text-danger">{error}</span>{/if}
      <span class="flex-1"></span>
      <Button variant={editing ? 'accent' : 'ghost'} onclick={() => (editing = !editing)} aria-pressed={editing}>{editing ? 'Done' : 'Edit pads'}</Button>
    </div>
    <div class="grid min-h-0 gap-1.5" style:grid-template-rows="repeat({rows.length}, minmax(0, 1fr))">
      {#each rows as row, r (r)}
        <div class="grid gap-1.5" style:grid-template-columns="repeat({COLUMNS}, minmax(0, 1fr))">
          {#each row as pad (pad.midi)}
            <button
              type="button"
              class={[
                'flex min-h-0 cursor-pointer touch-none flex-col items-start justify-between overflow-hidden rounded-lg px-2 py-1 text-left text-xs leading-tight select-none active:brightness-150',
                editing && 'outline-2 outline-dashed outline-accent/60',
              ]}
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
  </div>
{/if}

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
