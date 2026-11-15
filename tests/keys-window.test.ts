import { describe, expect, test } from 'bun:test'
import { centered, follow, splitRows, whitesFrom, whitesIn } from '../src/lib/keys-window'

const C3 = 48
const C4 = 60
const C5 = 72

describe('whitesFrom', () => {
  test('nine white keys from C reach the D an octave up', () => {
    expect(whitesFrom(C3, 9)).toEqual([C3, C4 + 2])
    expect(whitesIn(C3, C4 + 2)).toBe(9)
  })
})

describe('centered', () => {
  test('a short song sits in the middle of the keys that fit', () => {
    // C4–G4 is five whites; nine fit, so two spare go below.
    const [lo, hi] = centered(C4, C4 + 7, 9)
    expect(whitesIn(lo, hi)).toBe(9)
    expect(lo).toBe(C4 - 3) // A3
    expect(hi).toBeGreaterThanOrEqual(C4 + 7)
  })
})

describe('follow', () => {
  // A song from C3 to C6, nine keys on screen.
  const song = [C3, C5 + 12] as const
  const window = whitesFrom(C4, 9)

  test('stays put while the coming notes fit', () => {
    expect(follow(window, C4 + 2, C4 + 7, ...song, 9)).toBe(C4)
  })

  test('moves left when a note comes below', () => {
    expect(follow(window, C3 + 4, C4 + 4, ...song, 9)).toBe(C3 + 4)
  })

  test('slides right just enough for a high note while the low ones still show', () => {
    const start = follow(window, C4 + 4, C5 + 4, ...song, 9)
    const [lo, hi] = whitesFrom(start, 9)
    expect(lo).toBeLessThanOrEqual(C4 + 4)
    expect(hi).toBeGreaterThanOrEqual(C5 + 4)
  })

  test('never runs past the ends of the song', () => {
    expect(follow(window, C3 - 12, C3, ...song, 9)).toBe(C3)
    const [, hi] = whitesFrom(follow(window, C5 + 12, C5 + 12, ...song, 9), 9)
    expect(hi).toBe(C5 + 12)
  })
})

describe('splitRows', () => {
  test('two rows split at the middle white key, higher row first', () => {
    const [top, bottom] = splitRows(C3, C5 - 1)
    expect(bottom).toEqual({ lo: C3, hi: C4 - 1 })
    expect(top).toEqual({ lo: C4, hi: C5 - 1 })
  })
})
