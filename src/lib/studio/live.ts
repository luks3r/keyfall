/**
 * How played notes turn into sounding notes in Studio: transpose, scale lock and chords. One table maps every
 * input note, so the webview and the native fast paths (src-tauri `set_note_map`) play exactly the same notes.
 */

export const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
  'major pentatonic': [0, 2, 4, 7, 9],
  'minor pentatonic': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
} as const
export type ScaleName = keyof typeof SCALES

/** `steps` stack scale degrees on the played note (in scales); `semitones` is the chromatic fallback. */
export const CHORDS = {
  single: { label: 'Single notes', steps: [0], semitones: [0] },
  octave: { label: 'Octaves', steps: [0, 7], semitones: [0, 12] },
  fifth: { label: 'Power (1–5)', steps: [0, 4], semitones: [0, 7] },
  triad: { label: 'Triads', steps: [0, 2, 4], semitones: [0, 4, 7] },
  seventh: { label: 'Sevenths', steps: [0, 2, 4, 6], semitones: [0, 4, 7, 10] },
  sus: { label: 'Sus 4', steps: [0, 3, 4], semitones: [0, 5, 7] },
  ninth: { label: 'Add 9', steps: [0, 2, 4, 8], semitones: [0, 4, 7, 14] },
} as const
export type ChordName = keyof typeof CHORDS

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
export const MAX_TRANSPOSE = 24

export type LiveSettings = { transpose: number; root: number; scale: ScaleName; lock: boolean; chord: ChordName; velocity: number }

export const LIVE_DEFAULTS: LiveSettings = { transpose: 0, root: 0, scale: 'chromatic', lock: false, chord: 'single', velocity: 0.8 }

const clampNote = (midi: number) => Math.max(0, Math.min(127, midi))

/** Scale degree index of `midi` and its octave, or null when it is not in the scale. */
export function degreeOf(midi: number, root: number, scale: readonly number[]) {
  const relative = midi - root
  const octave = Math.floor(relative / 12)
  const index = scale.indexOf(((relative % 12) + 12) % 12)
  return index < 0 ? null : { index, octave }
}

/** Pure mapping, so tests and the table share it. */
export function mapNote(input: number, { transpose, root, scale, lock, chord }: LiveSettings): number[] {
  const degrees = SCALES[scale]
  let note = input + transpose
  if (lock && scale !== 'chromatic') {
    while (degreeOf(note, root, degrees) === null) note--
  }
  const shape = CHORDS[chord]
  const degree = scale === 'chromatic' ? null : degreeOf(note, root, degrees)
  const notes = degree
    ? shape.steps.map((step) => {
        const index = degree.index + step
        return root + (degree.octave + Math.floor(index / degrees.length)) * 12 + degrees[index % degrees.length]
      })
    : shape.semitones.map((semitones) => note + semitones)
  return [...new Set(notes.map(clampNote))]
}

