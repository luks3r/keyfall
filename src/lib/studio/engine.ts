import { clipNotes, type Clip, type Track } from './project'

/** `[length, (start, length, pitch, velocity)…]`, decoded by `Pattern::decode` in crates/dsp/src/sequencer.rs. */
export function encodePattern(clip: Clip): Float32Array<ArrayBuffer> {
  const notes = clipNotes(clip)
  const data = new Float32Array(1 + notes.length * 4)
  data[0] = clip.length
  notes.forEach((note, i) => data.set([note.start, note.length, note.pitch, note.velocity], 1 + i * 4))
  return data
}

/** `[start, length, clip id]…`, decoded by `Library::timeline` in crates/dsp/src/library.rs. */
export function encodeTimeline(track: Track, engineId: (clip: Clip) => number): Float32Array<ArrayBuffer> {
  return Float32Array.from(track.clips.flatMap((clip) => [clip.start, clip.length, engineId(clip)]))
}

/** Status layout of `Sequencer::write_status`. */
export const STATUS = { playing: 0, clock: 1, song: 2, tempo: 3, header: 4, perLane: 3 } as const
export const STOP_PENDING = 0xffffffff
