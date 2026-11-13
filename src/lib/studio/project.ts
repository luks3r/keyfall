import type { SynthPatch } from '../audio/patch'
import { createSong, handFor, type Song } from '../song'

/** Times are in beats. A clip plays `notes` from its start; content longer than `repeat` loops, which launcher slots will reuse. */
export type ClipNote = { pitch: number; start: number; length: number; velocity: number }
export type Clip = { id: string; start: number; length: number; repeat: number; quantize: number; notes: ClipNote[]; /** Preserves repeat intent when a clip is trimmed to its period or shorter. */ looped?: boolean }
/** A drum or sample pad: plays `sample` (see `src/lib/audio/samples.ts`) when `midi` is hit. */
export type Pad = { midi: number; name: string; sample: string | null }
/**
 * `clips` sit on the timeline; `slots` are the session grid cells, one per scene. Kit tracks (`preset === KIT`)
 * play `pads` instead of a synth.
 */
export type Track = {
  id: string
  name: string
  preset: string
  volume: number
  muted: boolean
  solo: boolean
  clips: Clip[]
  slots: (Clip | null)[]
  pads: Pad[]
  /** The track's own tweaks of its synth preset, made with the Sound knobs; absent plays the preset as is. */
  patch?: SynthPatch
}
export type Scene = { id: string; name: string }
export type Loop = { enabled: boolean; start: number; end: number }
export type Project = {
  version: 2
  name: string
  tempo: number
  beatsPerBar: number
  /** Launch quantization in beats; 0 launches immediately. */
  quantize: number
  /** Length of new loop recordings in session slots, in bars. */
  loopBars: number
  loop: Loop
  scenes: Scene[]
  tracks: Track[]
}

/** A note as the scheduler plays it: absolute beats, quantized and repeated. */
export type Scheduled = { track: number; pitch: number; start: number; end: number; velocity: number }

export const DEFAULT_TEMPO = 120
export const DEFAULT_PRESET = 'piano'
export const KIT = 'kit'
export const DEFAULT_SCENES = 8
export const QUANTIZE_GRIDS = [0, 1, 0.5, 0.25, 1 / 3, 0.125] as const
const MIN_NOTE = 1 / 64

export const uid = () => Math.random().toString(36).slice(2, 10)

export const createTrack = (name: string, preset = DEFAULT_PRESET, scenes = DEFAULT_SCENES, pads: Pad[] = []): Track => ({
  id: uid(),
  name,
  preset,
  volume: 0.8,
  muted: false,
  solo: false,
  clips: [],
  slots: Array(scenes).fill(null),
  pads,
})

export const createScene = (index: number): Scene => ({ id: uid(), name: String(index + 1) })

export const createClip = (start: number, length: number, notes: ClipNote[] = []): Clip => ({ id: uid(), start, length, repeat: length, quantize: 0, notes })

export const createProject = (name = 'Untitled'): Project => ({
  version: 2,
  name,
  tempo: DEFAULT_TEMPO,
  beatsPerBar: 4,
  quantize: 4,
  loopBars: 2,
  loop: { enabled: false, start: 0, end: 8 },
  scenes: Array.from({ length: DEFAULT_SCENES }, (_, i) => createScene(i)),
  tracks: [createTrack('Track 1')],
})

/** Brings a stored project of any earlier version to the current shape. */
export function migrate(stored: { version?: number } & Partial<Omit<Project, 'version'>>): Project | null {
  if (stored.version !== 1 && stored.version !== 2) return null
  const base = createProject()
  const project = { ...base, ...stored, version: 2 } as Project
  project.scenes ??= base.scenes
  for (const track of project.tracks) {
    track.slots ??= []
    track.pads ??= []
    track.slots.length = project.scenes.length
    track.slots = Array.from(track.slots, (slot) => slot ?? null)
  }
  return project
}

/** Every clip in the project, slots and timeline. */
export const allClips = (project: Project) => project.tracks.flatMap((t) => [...t.clips, ...t.slots.filter((c): c is Clip => !!c)])

export const snap = (beat: number, grid: number) => (grid ? Math.round(beat / grid) * grid : beat)

/** Notes the clip sounds within its own length, quantized and with its content repeated, relative to the clip start. */
export function clipNotes(clip: Clip): ClipNote[] {
  const repeat = clip.repeat > 0 ? clip.repeat : clip.length
  const notes: ClipNote[] = []
  for (let offset = 0; offset < clip.length; offset += repeat) {
    for (const note of clip.notes) {
      const at = snap(note.start, clip.quantize)
      if (at >= repeat || offset + at >= clip.length) continue
      const start = offset + at
      notes.push({ ...note, start, length: Math.min(Math.max(MIN_NOTE, note.length), clip.length - start) })
    }
  }
  return notes
}

export const clipEnd = (clip: Clip) => clip.start + clip.length

export const projectEnd = (project: Project) =>
  Math.max(project.beatsPerBar, ...project.tracks.flatMap((track) => track.clips.map(clipEnd)))

/** Every note the project will sound, sorted by start. Quantize is applied here, so recorded timing is never lost. */
export function schedule(project: Project): Scheduled[] {
  const notes: Scheduled[] = []
  project.tracks.forEach((track, index) => {
    for (const clip of track.clips) {
      for (const note of clipNotes(clip)) {
        const start = clip.start + note.start
        notes.push({ track: index, pitch: note.pitch, start, end: start + note.length, velocity: note.velocity })
      }
    }
  })
  return notes.sort((a, b) => a.start - b.start)
}

/** First index whose start is at or after `beat`. */
export function firstAt(notes: Scheduled[], beat: number) {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid].start < beat) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Practice view of a project: one part per track, in seconds. */
export function toSong(project: Project, only?: Set<string>): Song {
  const seconds = 60 / project.tempo
  const tracks = project.tracks.filter((track) => !only || only.has(track.id))
  const notes = schedule({ ...project, tracks }).map(({ track, pitch, start, end, velocity }) => ({
    midi: pitch,
    time: start * seconds,
    duration: (end - start) * seconds,
    velocity,
    hand: handFor(pitch),
    part: track,
  }))
  return createSong(project.name, tracks.map((track) => track.name), notes)
}

/** Producing view of a song: one track per part, one clip per track, at the default tempo. */
export function fromSong(song: Song): Project {
  const project = createProject(song.name)
  const beats = DEFAULT_TEMPO / 60
  const bar = project.beatsPerBar
  project.tracks = song.parts.map((name) => createTrack(name, DEFAULT_PRESET, project.scenes.length))
  const length = Math.max(bar, Math.ceil((song.duration * beats) / bar) * bar)
  project.tracks.forEach((track, part) => {
    const notes = song.notes
      .filter((note) => note.part === part)
      .map((note) => ({ pitch: note.midi, start: note.time * beats, length: note.duration * beats, velocity: note.velocity }))
    if (notes.length) track.clips.push(createClip(0, length, notes))
  })
  if (!project.tracks.length) project.tracks.push(createTrack('Track 1', DEFAULT_PRESET, project.scenes.length))
  return project
}
