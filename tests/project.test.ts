import { describe, expect, test } from 'bun:test'
import { createClip, createProject, createTrack, fromSong, schedule, toSong } from '../src/lib/studio/project'
import { estimateDelay } from '../src/lib/audio/calibration'
import { createSong } from '../src/lib/song'

const note = (pitch: number, start: number, length = 1) => ({ pitch, start, length, velocity: 0.8 })

describe('schedule', () => {
  test('places clip notes at absolute beats, sorted', () => {
    const project = createProject()
    project.tracks[0].clips.push(createClip(4, 4, [note(64, 1), note(60, 0)]))
    expect(schedule(project).map((n) => [n.pitch, n.start, n.end])).toEqual([
      [60, 4, 5],
      [64, 5, 6],
    ])
  })

  test('quantize is applied on playback, recorded timing stays', () => {
    const project = createProject()
    const clip = createClip(0, 4, [note(60, 0.93)])
    clip.quantize = 1
    project.tracks[0].clips.push(clip)
    expect(schedule(project)[0].start).toBe(1)
    expect(clip.notes[0].start).toBe(0.93)
  })

  test('content shorter than the clip repeats; notes are cut at the clip end', () => {
    const project = createProject()
    const clip = createClip(0, 6, [note(60, 0, 3)])
    clip.repeat = 2
    project.tracks[0].clips.push(clip)
    expect(schedule(project).map((n) => [n.start, n.end])).toEqual([
      [0, 3],
      [2, 5],
      [4, 6],
    ])
  })
})

describe('song bridges', () => {
  test('a song becomes one track per part and comes back in seconds', () => {
    const song = createSong('Duet', ['Right', 'Left'], [
      { midi: 72, time: 0.5, duration: 0.5, velocity: 1, hand: 1, part: 0 },
      { midi: 48, time: 0, duration: 2, velocity: 1, hand: 0, part: 1 },
    ])
    const project = fromSong(song)
    expect(project.tracks.map((t) => t.name)).toEqual(['Right', 'Left'])
    expect(project.tracks[0].clips[0].notes[0]).toMatchObject({ pitch: 72, start: 1, length: 1 })
    const back = toSong(project)
    expect(back.notes.map((n) => [n.midi, n.time, n.duration, n.part])).toEqual([
      [48, 0, 2, 1],
      [72, 0.5, 0.5, 0],
    ])
  })

  test('practising one track keeps only its notes', () => {
    const project = createProject()
    project.tracks.push(createTrack('Bass'))
    project.tracks[0].clips.push(createClip(0, 4, [note(72, 0)]))
    project.tracks[1].clips.push(createClip(0, 4, [note(36, 0)]))
    const song = toSong(project, new Set([project.tracks[1].id]))
    expect(song.parts).toEqual(['Bass'])
    expect(song.notes.map((n) => n.midi)).toEqual([36])
  })
})

describe('calibration', () => {
  test('median tap offset after the settle clicks', () => {
    const clicks = Array.from({ length: 16 }, (_, i) => i * 500)
    expect(estimateDelay(clicks, clicks.map((c) => c + 40))?.delay).toBe(40)
    expect(estimateDelay(clicks, clicks.slice(0, 6))).toBeNull()
  })
})

describe('live clips', () => {
  test('patterns carry the clip length and its repeated, quantized notes', async () => {
    const { encodePattern } = await import('../src/lib/studio/engine')
    const clip = createClip(0, 4, [note(60, 0.9, 0.5)])
    clip.repeat = 2
    clip.quantize = 1
    expect([...encodePattern(clip)]).toEqual([4, 1, 0.5, 60, 0.800000011920929, 3, 0.5, 60, 0.800000011920929])
  })

  test('version 1 projects gain scenes and empty slots', async () => {
    const { migrate } = await import('../src/lib/studio/project')
    const old = { version: 1, name: 'Old', tempo: 100, beatsPerBar: 4, loop: { enabled: false, start: 0, end: 8 }, tracks: [{ ...createTrack('Piano'), slots: undefined, pads: undefined }] }
    const project = migrate(old as never)!
    expect(project.version).toBe(2)
    expect(project.scenes.length).toBe(8)
    expect(project.tracks[0].slots).toEqual(Array(8).fill(null))
    expect(project.tracks[0].pads).toEqual([])
    expect(migrate({ version: 7 } as never)).toBeNull()
  })
})

describe('live input', () => {
  const settings = (over: object) => ({ transpose: 0, root: 0, scale: 'chromatic', lock: false, chord: 'single', velocity: 0.8, ...over }) as never

  test('transpose and scale lock move notes into the key', async () => {
    const { mapNote } = await import('../src/lib/studio/live')
    expect(mapNote(60, settings({ transpose: 2 }))).toEqual([62])
    expect(mapNote(61, settings({ scale: 'major', lock: true }))).toEqual([60])
    expect(mapNote(66, settings({ scale: 'major', lock: true, root: 7 }))).toEqual([66])
  })

  test('chords follow the scale, or fixed intervals without one', async () => {
    const { mapNote } = await import('../src/lib/studio/live')
    expect(mapNote(60, settings({ chord: 'triad' }))).toEqual([60, 64, 67])
    expect(mapNote(62, settings({ chord: 'triad', scale: 'major' }))).toEqual([62, 65, 69])
    expect(mapNote(71, settings({ chord: 'seventh', scale: 'major' }))).toEqual([71, 74, 77, 81])
    expect(mapNote(69, settings({ chord: 'triad', scale: 'minor', root: 9 }))).toEqual([69, 72, 76])
    expect(mapNote(127, settings({ chord: 'octave' }))).toEqual([127])
  })
})
