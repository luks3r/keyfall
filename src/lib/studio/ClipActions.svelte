<script lang="ts">
  import Button from '../ui/Button.svelte'
  import type { ClipEditor } from './panels'
  import type { Clip, Track } from './project'
  import { studio } from './studio.svelte'
  let { track, clip, onedit }: { track: Track; clip: Clip; onedit: (editor?: ClipEditor) => void } = $props()
  const timeline = $derived(track.clips.some(c => c.id === clip.id))
</script>
<div class="clip-actions flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2" data-input-scope="ui">
  <span class="min-w-0 mr-auto truncate text-xs text-muted">{track.name} · {clip.length / studio.project.beatsPerBar} bars · {clip.notes.length} notes</span>
  <Button onclick={() => onedit('steps')} aria-label="Edit in Steps">Steps</Button>
  <Button onclick={() => onedit('notes')} aria-label="Edit in Notes">Notes</Button>
  <Button onclick={() => studio.duplicateClip(track, clip)} aria-label="Duplicate selected clip">Duplicate</Button>
  {#if timeline}
    <label class="flex items-center gap-1 text-xs text-muted">Start (beat)
      <input class="w-16 bg-raised px-1" aria-label="Clip start beat" type="number" min="0" step="0.25" value={clip.start} onchange={(e) => { studio.setClipBounds(track.id,clip.id,e.currentTarget.valueAsNumber,clip.length); e.currentTarget.value=String(clip.start) }} />
    </label>
    <label class="flex items-center gap-1 text-xs text-muted">Length (beats)
      <input class="w-16 bg-raised px-1" aria-label="Clip length beats" type="number" min="0.25" step="0.25" value={clip.length} onchange={(e) => { studio.setClipBounds(track.id,clip.id,clip.start,e.currentTarget.valueAsNumber); e.currentTarget.value=String(clip.length) }} />
    </label>
    {#if clip.repeat < clip.length}<span class="text-xs text-muted">Repeats every {clip.repeat} beats</span>{/if}
  {/if}
  <Button variant="danger" onclick={() => studio.removeClip(track,clip.id)} aria-label="Delete selected clip">Delete</Button>
</div>
