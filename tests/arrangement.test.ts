import { expect, test } from 'bun:test'
import { createClip, clipNotes } from '../src/lib/studio/project'
import { gridFor, findAvailableStart, overlaps, resizeBounds } from '../src/lib/studio/arrangement'
test('arrangement snap uses musical divisions', () => {
  expect(gridFor('bar', 3)).toBe(3); expect(gridFor('beat', 4)).toBe(1)
  expect(gridFor('eighth', 4)).toBe(.5); expect(gridFor('sixteenth', 4)).toBe(.25)
})
test('placement skips occupied intervals independent of order', () => {
  const clips = [createClip(4,4), createClip(0,4), createClip(6,3)]
  expect(findAvailableStart(clips,4,4,1)).toBe(9)
  expect(findAvailableStart(clips.slice(0,2),4,4,1)).toBe(8)
  expect(findAvailableStart([], -.7,4,1)).toBe(0)
  expect(findAvailableStart([], .1,4,.25)).toBe(.25)
  expect(overlaps([createClip(4,4)],8,4)).toBe(false)
  expect(overlaps(clips,5,1)).toBe(true)
})
test('resize preserves repeat mode and source notes', () => {
  const ordinary = createClip(0,8,[{pitch:60,start:6,length:1,velocity:1}])
  const source = JSON.stringify(ordinary.notes)
  Object.assign(ordinary,resizeBounds(ordinary,4,1))
  expect([ordinary.length,ordinary.repeat]).toEqual([4,4])
  expect(clipNotes(ordinary)).toHaveLength(0)
  Object.assign(ordinary,resizeBounds(ordinary,8,1))
  expect(clipNotes(ordinary)).toHaveLength(1)
  expect(JSON.stringify(ordinary.notes)).toBe(source)
  ordinary.repeat=2
  expect(resizeBounds(ordinary,4,1)).toEqual({length:4,repeat:2})
  expect(resizeBounds(ordinary,-2,.25).length).toBe(.25)
})
