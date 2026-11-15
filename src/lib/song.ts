export type Hand = 0 | 1
export type Note = { midi: number; time: number; duration: number; velocity: number; hand: Hand; part: number }
/** `tempo` (bpm) and `beatsPerBar` come from a MIDI file's header, so Studio can lay its notes on the right bars. */
export type Song = { name: string; parts: string[]; notes: Note[]; duration: number; longest: number; tempo?: number; beatsPerBar?: number }

const LEFT: Hand = 0
const RIGHT: Hand = 1
const MIDDLE_C = 60

export const handFor = (midi: number): Hand => (midi >= MIDDLE_C ? RIGHT : LEFT)

const HAND_PARTS = ['Right hand', 'Left hand']
const handPart = (hand: Hand) => (hand === RIGHT ? 0 : 1)

export function createSong(name: string, parts: string[], notes: Note[]): Song {
  notes.sort((a, b) => a.time - b.time || a.midi - b.midi)
  let duration = 1
  let longest = 0
  for (const n of notes) {
    duration = Math.max(duration, n.time + n.duration)
    longest = Math.max(longest, n.duration)
  }
  return { name, parts, notes, duration, longest }
}

export function lowerBound(notes: Note[], time: number) {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid].time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

export const parseMidi = async (file: File) => parseMidiBytes(await file.arrayBuffer(), file.name.replace(/\.midi?$/i, ''))

export async function parseMidiBytes(bytes: ArrayBuffer, name: string): Promise<Song> {
  const { Midi } = await import('@tonejs/midi')
  const midi = new Midi(bytes)
  const tracks = midi.tracks.filter((track) => track.notes.length && !track.instrument.percussion)
  if (!tracks.length) throw new Error('No playable notes')
  const meter = { tempo: midi.header.tempos[0]?.bpm, beatsPerBar: beatsPerBar(midi.header.timeSignatures[0]?.timeSignature) }
  if (tracks.length === 1) {
    const notes = tracks[0].notes.map(({ midi, time, duration, velocity }) => {
      const hand = handFor(midi)
      return { midi, time, duration, velocity, hand, part: handPart(hand) }
    })
    return { ...createSong(name, HAND_PARTS, notes), ...meter }
  }
  const parts = tracks.map((track, i) => track.name.trim() || `Part ${i + 1}`)
  const notes = tracks.flatMap((track, part) =>
    track.notes.map(({ midi, time, duration, velocity }) => ({ midi, time, duration, velocity, hand: part === 0 ? RIGHT : LEFT, part })),
  )
  return { ...createSong(name, parts, notes), ...meter }
}

/** Quarter-note beats in a bar of `numerator/denominator` time: 3/4 → 3, 6/8 → 3, 12/8 → 6. */
export function beatsPerBar(signature: number[] | undefined) {
  const [numerator, denominator] = signature ?? []
  if (!numerator || !denominator) return undefined
  return Math.max(1, Math.round((numerator * 4) / denominator))
}

export async function toMidi(song: Song): Promise<Uint8Array<ArrayBuffer>> {
  const { Midi } = await import('@tonejs/midi')
  const midi = new Midi()
  midi.name = song.name
  if (song.tempo) midi.header.setTempo(song.tempo)
  if (song.beatsPerBar) midi.header.timeSignatures.push({ ticks: 0, timeSignature: [song.beatsPerBar, 4] })
  const tracks = song.parts.map((name) => Object.assign(midi.addTrack(), { name }))
  for (const { midi: pitch, time, duration, velocity, part } of song.notes) {
    tracks[part].addNote({ midi: pitch, time, duration, velocity })
  }
  return midi.toArray() as Uint8Array<ArrayBuffer>
}

const PITCH: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function sequence(source: string, hand: Hand, bpm: number): Note[] {
  const beat = 60 / bpm
  let time = 0
  return source.trim().split(/\s+/).map((token) => {
    const [, letter, accidental, octave, beats = '1'] = token.match(/^([A-G])([#b]?)(\d)(?::([\d.]+))?$/)!
    const midi = 12 * (Number(octave) + 1) + PITCH[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0)
    const length = Number(beats) * beat
    const note = { midi, time, duration: length * 0.92, velocity: hand === RIGHT ? 0.75 : 0.55, hand, part: handPart(hand) }
    time += length
    return note
  })
}

const ODE_MELODY = `
  E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4:1.5 D4:.5 D4:2
  E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4:1.5 C4:.5 C4:2`
const ODE_BASS = `C3:4 G3:4 C3:4 G3:4 C3:4 G3:4 C3:4 G3:2 C3:2`

export const demo = createSong('Ode to Joy', HAND_PARTS, [...sequence(ODE_MELODY, RIGHT, 100), ...sequence(ODE_BASS, LEFT, 100)])
