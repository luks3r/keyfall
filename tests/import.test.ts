import { describe, expect, test } from 'bun:test'
import { renderDrum } from '../src/lib/audio/drums'
import { beatsPerBar, createSong } from '../src/lib/song'
import { fromSong } from '../src/lib/studio/project'

describe('MIDI import', () => {
  test('time signatures become quarter-note beats per bar', () => {
    expect(beatsPerBar([4, 4])).toBe(4)
    expect(beatsPerBar([3, 4])).toBe(3)
    expect(beatsPerBar([6, 8])).toBe(3)
    expect(beatsPerBar([12, 8])).toBe(6)
    expect(beatsPerBar(undefined)).toBeUndefined()
  })

  test("Studio lays notes on the song's own tempo and bars", () => {
    const song = { ...createSong('Waltz', ['Melody'], [{ midi: 60, time: 2, duration: 1, velocity: 0.8, hand: 1, part: 0 }]), tempo: 90, beatsPerBar: 3 }
    const project = fromSong(song)
    expect(project.tempo).toBe(90)
    expect(project.beatsPerBar).toBe(3)
    const clip = project.tracks[0].clips[0]
    expect(clip.notes[0].start).toBeCloseTo(3)
    expect(clip.notes[0].length).toBeCloseTo(1.5)
    expect(clip.length % 3).toBe(0)
  })

  test('songs without a tempo keep the default', () => {
    const project = fromSong(createSong('Plain', ['Melody'], [{ midi: 60, time: 1, duration: 0.5, velocity: 0.8, hand: 1, part: 0 }]))
    expect(project.tempo).toBe(120)
    expect(project.tracks[0].clips[0].notes[0].start).toBeCloseTo(2)
  })
})

describe('drum kits', () => {
  test('every kit renders every drum', () => {
    for (const key of ['kick', 'kit-808/kick', 'kit-808/hat-open', 'kit-909/snare', 'kit-909/shaker']) {
      const data = renderDrum(key)
      expect(data?.length).toBeGreaterThan(0)
      expect(data!.every(Number.isFinite)).toBe(true)
    }
    expect(renderDrum('kit-808/nope')).toBeNull()
  })

  test('808 and 909 kicks sound different from the studio kick', () => {
    const peak = (key: string) => renderDrum(key)!.length
    expect(peak('kit-808/kick')).toBeGreaterThan(peak('kick'))
    expect(renderDrum('kit-909/kick')!.slice(0, 2000)).not.toEqual(renderDrum('kick')!.slice(0, 2000))
  })
})
