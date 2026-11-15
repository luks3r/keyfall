/**
 * Which piano keys fit on screen. Counted in white keys, since those set a key's width. Pure, so the tests need no
 * browser.
 */

export const LOWEST_NOTE = 21
export const HIGHEST_NOTE = 108

const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false]
export const isBlack = (midi: number) => BLACK[((midi % 12) + 12) % 12]
export const whiteAtOrBelow = (midi: number) => (isBlack(midi) ? midi - 1 : midi)
export const whiteAtOrAbove = (midi: number) => (isBlack(midi) ? midi + 1 : midi)

export function whitesIn(lo: number, hi: number) {
  let count = 0
  for (let m = lo; m <= hi; m++) if (!isBlack(m)) count++
  return count
}

/** From white key `lo` up to and including the `whites`th white key. */
export function whitesFrom(lo: number, whites: number): readonly [number, number] {
  let hi = lo
  for (let count = 1; count < whites && hi < HIGHEST_NOTE; ) if (!isBlack(++hi)) count++
  return [lo, hi]
}

/** `whites` white keys with the notes `lo`–`hi` in the middle. */
export function centered(lo: number, hi: number, whites: number): readonly [number, number] {
  let start = whiteAtOrBelow(lo)
  const spare = whites - whitesIn(start, whiteAtOrAbove(hi))
  for (let i = 0; i < Math.floor(spare / 2) && start > LOWEST_NOTE; i++) start = whiteAtOrBelow(start - 1)
  return whitesFrom(start, whites)
}

/**
 * Where a window of `whites` keys should start so the coming notes (`min`–`max`) show, for a song spanning
 * `songLo`–`songHi`. It stays put while they fit (keys moving under a finger are hard to hit). Otherwise the lowest
 * coming note sets the left edge, or for notes rising past the right edge it slides only as far as needed while the
 * low ones still show.
 */
export function follow(window: readonly [number, number], min: number, max: number, songLo: number, songHi: number, whites: number) {
  const [lo, hi] = window
  if (min >= lo && max <= hi) return lo
  let start = whiteAtOrBelow(min)
  if (max > hi && min >= lo) {
    start = lo
    while (whitesFrom(start, whites)[1] < max && start < whiteAtOrBelow(min)) start = whiteAtOrAbove(start + 1)
  }
  const first = whiteAtOrBelow(songLo)
  const last = whitesFrom(first, Math.max(1, whitesIn(first, whiteAtOrAbove(songHi)) - whites + 1))[1]
  return Math.max(first, Math.min(start, last))
}

/** Splits keys for two stacked rows at the white key past the middle: [higher row, lower row]. */
export function splitRows(lo: number, hi: number): [{ lo: number; hi: number }, { lo: number; hi: number }] {
  const half = Math.ceil(whitesIn(lo, hi) / 2)
  let mid = lo
  for (let count = 0; mid <= hi; mid++) if (!isBlack(mid) && ++count > half) break
  return [
    { lo: mid, hi },
    { lo, hi: mid - 1 },
  ]
}
