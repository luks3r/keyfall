import { snap, type Clip } from './project'
export type ArrangementSnap = 'bar' | 'beat' | 'eighth' | 'sixteenth'
export const gridFor = (value: ArrangementSnap, beatsPerBar: number) => ({ bar: beatsPerBar, beat: 1, eighth: .5, sixteenth: .25 })[value]
export const overlaps = (clips: readonly Clip[], start: number, length: number, excludeId?: string) => clips.some(c => c.id !== excludeId && start < c.start + c.length && start + length > c.start)
export function findAvailableStart(clips: readonly Clip[], requested: number, length: number, grid: number) {
  let start = Math.max(0, Math.ceil(requested / grid) * grid)
  for (const clip of [...clips].sort((a,b) => a.start-b.start)) {
    if (start < clip.start + clip.length && start + length > clip.start) start = Math.ceil((clip.start + clip.length) / grid) * grid
  }
  return start
}
export function resizeBounds(clip: Clip, requestedLength: number, grid: number): Pick<Clip,'length'|'repeat'> {
  const length = Math.max(grid, snap(requestedLength, grid))
  return { length, repeat: clip.repeat < clip.length ? clip.repeat : length }
}
