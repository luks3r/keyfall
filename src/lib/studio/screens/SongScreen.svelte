<script lang="ts">
  import { choiceKnob, knobs, rangeKnob, type KnobSpec } from '../../device/knobs.svelte'
  import { shortcuts } from '../../device/shortcuts.svelte'
  import SoftKeys, { type SoftKey } from '../../device/SoftKeys.svelte'
  import type { ArrangementSnap } from '../arrangement'
  import Arrangement, { ARRANGEMENT_ZOOMS } from '../Arrangement.svelte'
  import { studio } from '../studio.svelte'

  /** The timeline: arrange clips into a song, loop a section, and move the piece in and out of Keyfall. */
  let { onimport, onexport, onpractice }: { onimport: () => void; onexport: () => void; onpractice: () => void } = $props()

  const MAX_BARS = 128
  const DEFAULT_ZOOM = 3
  const SNAPS: ArrangementSnap[] = ['bar', 'beat', 'eighth', 'sixteenth']
  const SNAP_NAMES: Record<ArrangementSnap, string> = { bar: 'bar', beat: 'beat', eighth: '1/8', sixteenth: '1/16' }
  const project = $derived(studio.project)
  const bar = $derived(project.beatsPerBar)
  let zoomIndex = $state(DEFAULT_ZOOM)

  const specs = $derived<(KnobSpec | null)[]>([
    rangeKnob('Position', 0, MAX_BARS, () => studio.position / bar, (v) => studio.seek(v * bar), (v) => `bar ${Math.floor(v) + 1}`, {
      initial: 0,
      step: 1,
      parse: (text) => {
        const v = Number.parseFloat(text.replace(/[^\d.]/g, ''))
        return Number.isFinite(v) ? v - 1 : null
      },
    }),
    choiceKnob('Snap', SNAPS, () => studio.arrangementSnap, (v) => (studio.arrangementSnap = v), (v) => SNAP_NAMES[v], 'beat'),
    choiceKnob('Zoom', ARRANGEMENT_ZOOMS.map((_, i) => i), () => zoomIndex, (v) => (zoomIndex = v), (v) => `${v + 1}×`, DEFAULT_ZOOM),
    choiceKnob('Loop', [false, true], () => project.loop.enabled, (on) => on !== project.loop.enabled && studio.toggleLoop(), (on) => (on ? 'on' : 'off'), false),
  ])

  $effect(() => knobs.use(specs))

  const selected = $derived(studio.clip && studio.track?.clips.includes(studio.clip) ? studio.clip : null)

  function newClip() {
    const track = studio.track
    if (!track) return
    studio.addArrangementClip(track.id, studio.insertion?.trackId === track.id ? studio.insertion.beat : studio.position)
  }

  /** The toolbar follows the selection: a selected clip's actions come first, so holding a clip is never the only way. */
  const clipKeys = $derived.by((): SoftKey[] => {
    const track = studio.track
    if (!selected || !track) return []
    return [
      { label: 'Edit clip', onclick: () => studio.openClipEditor(track.id, selected.id), title: 'Open the selected clip on the Pattern screen', shortcut: 'Enter' },
      { label: 'Duplicate', onclick: () => studio.duplicateClip(track, selected), title: 'Copy the selected clip after itself', shortcut: 'Mod+D' },
      { label: 'Loop clip', onclick: () => studio.loopClip(track.id, selected.id), title: 'Loop the song around the selected clip' },
      { label: 'Delete clip', onclick: () => studio.removeClip(track, selected.id), shortcut: 'Delete' },
    ]
  })
  const songKeys = $derived<SoftKey[]>([
    { label: 'New clip', onclick: newClip, title: 'New clip at the playhead on the selected track', shortcut: 'Alt+N' },
    { label: 'Open MIDI', onclick: onimport, shortcut: 'Mod+O' },
    { label: 'Export MIDI', onclick: onexport, shortcut: 'Mod+E' },
    { label: 'Learn', onclick: onpractice, title: 'Learn this song on the Piano with falling notes' },
  ])

  $effect(() =>
    shortcuts.use('Song', [
      { keys: ['Alt+N'], label: 'New clip at the playhead', run: newClip },
      { keys: ['Delete', 'Backspace'], label: 'Delete the selected clip', run: () => selected && studio.track && studio.removeClip(studio.track, selected.id), when: () => !!selected },
      { keys: ['Mod+D'], label: 'Duplicate the selected clip after itself', run: () => selected && studio.track && studio.duplicateClip(studio.track, selected), when: () => !!selected },
      { keys: ['Escape'], label: 'Select no clip', run: () => studio.select(studio.track?.id ?? null), when: () => !!selected },
      { keys: ['Enter'], label: 'Edit the focused clip' },
      { keys: ['Mod+Scroll'], label: 'Zoom the timeline' },
    ]),
  )
</script>

<div class="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
  <Arrangement bind:zoomIndex />
  <SoftKeys keys={[...clipKeys, ...songKeys]} />
</div>
