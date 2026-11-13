<script lang="ts">
  import { choiceKnob, knobs, percentKnob, rangeKnob, type KnobSpec } from '../../device/knobs.svelte'
  import { shortcuts } from '../../device/shortcuts.svelte'
  import SoftKeys from '../../device/SoftKeys.svelte'
  import { symbol } from '../../input/keymaps'
  import { trackColor } from '../Arrangement.svelte'
  import { controls } from '../controls.svelte'
  import { CHORDS, LIVE_DEFAULTS, live, MAX_TRANSPOSE, NOTE_NAMES, SCALES, mapNote, type ChordName, type ScaleName } from '../live.svelte'
  import { DEFAULT_TEMPO, type Clip, type Track } from '../project'
  import { LAUNCH_KEYS, STOP, studio } from '../studio.svelte'
  import { studioUi } from '../ui.svelte'

  /**
   * Page 1 (Clips): launch the bank's patterns live. Tap a pattern to launch it, ■ stops a track; double-click an
   * empty cell to start a pattern there; right-click or hold a pattern to edit it.
   * Page 2 (Keys): how played keys turn into notes (transpose, scale, chords).
   */
  let { bank, page }: { bank: Track[]; page: number } = $props()

  const HOLD_MS = 450
  const QUANTIZE = [0, 1, 2, 4, 8]
  const DEFAULT_QUANTIZE = 4
  const QUANTIZE_NAMES = new Map([
    [0, 'now'],
    [1, 'beat'],
    [2, '½ bar'],
    [4, 'bar'],
    [8, '2 bars'],
  ])
  const keyFor = new Map([...LAUNCH_KEYS].map(([code, cell]) => [`${cell.track}:${cell.scene}`, code]))

  const project = $derived(studio.project)
  const scenes = $derived(project.scenes.map((_, i) => i))
  const settings = $derived(live.settings)

  let holding = 0
  let held = false

  function down(track: Track, scene: number) {
    held = false
    clearTimeout(holding)
    holding = window.setTimeout(() => {
      held = true
      studio.selectSlot(track.id, scene)
      studioUi.show('pattern')
    }, HOLD_MS)
  }

  function up(track: Track, scene: number, clip: Clip | null) {
    clearTimeout(holding)
    if (held) return
    const index = project.tracks.indexOf(track)
    if (controls.learning) return controls.arm({ kind: 'slot', track: index, scene })
    studio.selectSlot(track.id, scene)
    if (clip) studio.launch(track, clip)
  }

  function edit(track: Track, scene: number) {
    studio.selectSlot(track.id, scene)
    studioUi.show('pattern')
  }

  function create(track: Track, scene: number) {
    if (track.slots[scene] || controls.learning) return
    studio.addSlotClip(track, scene)
    studioUi.show('pattern')
  }

  const progress = (clip: Clip, origin: number) => ((((studio.beat - origin) % clip.length) + clip.length) % clip.length) / clip.length

  const specs = $derived.by((): (KnobSpec | null)[] =>
    page === 0
      ? [
          rangeKnob('Tempo', 40, 240, () => project.tempo, (v) => studio.setTempo(v), (v) => `${Math.round(v)} bpm`, { initial: DEFAULT_TEMPO, step: 1 }),
          choiceKnob('Launch on', QUANTIZE, () => project.quantize, (v) => (project.quantize = v), (v) => QUANTIZE_NAMES.get(v) ?? '', DEFAULT_QUANTIZE),
          choiceKnob('Scene', scenes, () => studio.selectedScene, (v) => (studio.selectedScene = v), (v) => project.scenes[v]?.name ?? '', 0),
          percentKnob('Velocity', () => settings.velocity, (v) => (settings.velocity = v), LIVE_DEFAULTS.velocity, 0.1),
        ]
      : [
          rangeKnob('Transpose', -MAX_TRANSPOSE, MAX_TRANSPOSE, () => settings.transpose, (v) => (settings.transpose = Math.round(v)), (v) => `${v > 0 ? '+' : ''}${Math.round(v)} st`, { initial: 0, step: 1 }),
          choiceKnob('Root', NOTE_NAMES.map((_, i) => i), () => settings.root, (v) => (settings.root = v), (v) => NOTE_NAMES[v], LIVE_DEFAULTS.root),
          choiceKnob('Scale', Object.keys(SCALES) as ScaleName[], () => settings.scale, (v) => (settings.scale = v), String, LIVE_DEFAULTS.scale),
          choiceKnob('Chord', Object.keys(CHORDS) as ChordName[], () => settings.chord, (v) => (settings.chord = v), (v) => CHORDS[v].label, LIVE_DEFAULTS.chord),
        ],
  )

  $effect(() => knobs.use(specs))

  $effect(() =>
    page === 0
      ? shortcuts.use('Clips', [
          { keys: ['Mod+.'], label: 'Stop all', run: () => studio.stopAll() },
          { keys: ['Enter', '↑', '↓'], label: 'Keys launch: launch the scene / pick the scene (letter rows launch patterns)' },
        ])
      : undefined,
  )

  /** Two octaves from the root, showing what pressing the root key plays. */
  const preview = $derived.by(() => {
    const start = 60 + settings.root - 12
    const played = new Set(mapNote(60 + settings.root, settings))
    const degrees: readonly number[] = SCALES[settings.scale]
    return Array.from({ length: 25 }, (_, i) => {
      const midi = start + i
      return { midi, black: [1, 3, 6, 8, 10].includes(midi % 12), inScale: degrees.includes((((midi - settings.root) % 12) + 12) % 12), played: played.has(midi) }
    })
  })
</script>

{#if page === 0}
  <div class="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
    <div class="grid min-h-0 gap-1 overflow-y-auto p-2" style:grid-template-columns="repeat({bank.length}, minmax(0, 1fr)) 3.5rem" role="grid" aria-label="Clip grid">
      {#each bank as track (track.id)}
        {@const index = project.tracks.indexOf(track)}
        <button
          type="button"
          class={['h-7 truncate rounded px-1.5 text-left font-mono text-[11px] uppercase', studio.track?.id === track.id ? 'bg-fg text-bg' : 'text-muted']}
          style:box-shadow="inset 0 -2px 0 {trackColor(index)}"
          onclick={() => studio.select(track.id)}>{track.name}</button
        >
      {/each}
      <span></span>
      {#each project.scenes as scene, s (scene.id)}
        {#each bank as track (track.id)}
          {@const index = project.tracks.indexOf(track)}
          {@const clip = track.slots[s]}
          {@const state = studio.lanes[index]}
          {@const active = !!clip && state?.active === clip.id}
          {@const queued = !!clip && state?.queued === clip.id}
          {@const key = studio.launchMode ? keyFor.get(`${index}:${s}`) : undefined}
          <button
            type="button"
            class={['relative min-h-10 touch-none overflow-hidden rounded-md select-none', clip ? '' : 'border border-dashed border-line', queued && 'animate-pulse', studio.track?.id === track.id && studio.selectedScene === s && 'ring-2 ring-fg/60', controls.isArmed({ kind: 'slot', track: index, scene: s }) && 'ring-2 ring-[var(--color-knob-blue)]']}
            style:background={clip ? `color-mix(in srgb, ${trackColor(index)} ${active ? 70 : 28}%, transparent)` : undefined}
            onpointerdown={() => down(track, s)}
            onpointerup={() => up(track, s, clip)}
            onpointerleave={() => clearTimeout(holding)}
            ondblclick={() => create(track, s)}
            oncontextmenu={(e) => (e.preventDefault(), edit(track, s))}
            aria-label={clip ? `${active ? 'Playing' : 'Launch'} ${track.name} pattern ${s + 1}` : `Empty: ${track.name} pattern ${s + 1}`}
            title={clip ? 'Tap to launch · right-click or hold to edit' : 'Double-click to start a pattern'}
            aria-pressed={active}
          >
            {#if active && state}<span class="absolute bottom-0 left-0 h-1 bg-fg" style:width="{progress(clip!, state.origin) * 100}%"></span>{/if}
            {#if key}<span class="absolute top-1 left-1.5 font-mono text-[10px] text-muted">{symbol(key)}</span>{/if}
          </button>
        {/each}
        <button
          type="button"
          class={['min-h-10 rounded-md font-mono text-xs', studio.selectedScene === s ? 'bg-fg text-bg' : 'bg-raised']}
          onclick={() => (controls.learning ? controls.arm({ kind: 'scene', scene: s }) : studio.launchScene(s))}
          aria-label="Launch scene {scene.name}"
          title="Launch every pattern in this row">▶ {scene.name}</button
        >
      {/each}
      {#each bank as track (track.id)}
        {@const index = project.tracks.indexOf(track)}
        <button
          type="button"
          class={['h-8 rounded-md bg-raised font-mono text-xs text-muted', studio.lanes[index]?.queued === STOP && 'animate-pulse text-fg']}
          onclick={() => (controls.learning ? controls.arm({ kind: 'stop', track: index }) : studio.launch(track, null))}
          aria-label="Stop {track.name}"
          title="Stop {track.name}">■</button
        >
      {/each}
    </div>
    <SoftKeys
      keys={[
        { label: 'Stop all', onclick: () => studio.stopAll(), shortcut: 'Mod+.' },
        { label: 'Add scene', onclick: () => studio.addScene() },
        { label: 'Keys launch', onclick: () => studio.toggleLaunchMode(), active: studio.launchMode, title: 'Letter keys launch patterns instead of playing notes', shortcut: 'Tab' },
        { label: 'MIDI map', onclick: () => ((controls.learning = !controls.learning), (controls.armed = null)), active: controls.learning, title: 'Tap a pattern, scene or stop, then press a controller button' },
      ]}
    />
  </div>
{:else}
  <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-2 p-4">
    <p class="text-2xl font-medium">
      {NOTE_NAMES[settings.root]} {settings.scale} <span class="text-muted">· {CHORDS[settings.chord].label.toLowerCase()} · {settings.transpose > 0 ? '+' : ''}{settings.transpose} st</span>
    </p>
    <div class="flex min-h-0 items-stretch gap-1 py-2" aria-label="Keys preview: highlighted keys sound when you press {NOTE_NAMES[settings.root]}">
      {#each preview as key (key.midi)}
        <span
          class={['rounded-sm', key.black ? 'h-3/5 flex-[0.6] self-start bg-muted' : 'flex-1 bg-[var(--color-key-white)]', !key.inScale && 'opacity-25']}
          style:background={key.played ? 'var(--color-knob-orange)' : undefined}
        ></span>
      {/each}
    </div>
    <SoftKeys keys={[{ label: 'Lock to scale', onclick: () => (settings.lock = !settings.lock), active: settings.lock, disabled: settings.scale === 'chromatic', title: 'Wrong notes snap down into the scale' }]} />
  </div>
{/if}
