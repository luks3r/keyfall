export const CLICKS = 16
export const INTERVAL_MS = 500
/** Taps on the first clicks are ignored while the player finds the beat. */
const SETTLE_CLICKS = 4
const MIN_TAPS = 6

export type Estimate = { delay: number; spread: number; taps: number }

/** Median offset of taps from the clicks they answer; null when too few taps line up. */
export function estimateDelay(clicks: number[], taps: number[]): Estimate | null {
  const offsets: number[] = []
  for (const tap of taps) {
    let best = Infinity
    let index = -1
    clicks.forEach((click, i) => {
      if (Math.abs(tap - click) < Math.abs(best)) [best, index] = [tap - click, i]
    })
    if (index >= SETTLE_CLICKS && Math.abs(best) < INTERVAL_MS / 2) offsets.push(best)
  }
  if (offsets.length < MIN_TAPS) return null
  offsets.sort((a, b) => a - b)
  const median = offsets[offsets.length >> 1]
  const deviations = offsets.map((offset) => Math.abs(offset - median)).sort((a, b) => a - b)
  return { delay: Math.max(0, median), spread: deviations[deviations.length >> 1], taps: offsets.length }
}
