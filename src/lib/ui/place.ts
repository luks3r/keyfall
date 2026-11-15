/**
 * Where a floating element goes: beside its anchor, inside the free area of the screen. It takes the preferred side
 * when the element fits there, else whichever side has more room, then slides along that side to stay on screen.
 * `maxHeight` / `maxWidth` are the room on the chosen side, so a long list scrolls instead of running off the edge.
 *
 * Pure numbers in, numbers out, so it is tested without a browser.
 */
export type Box = { top: number; left: number; width: number; height: number }
export type Area = { top: number; left: number; right: number; bottom: number }
export type Side = 'bottom' | 'top' | 'right' | 'left'
export type Align = 'start' | 'center' | 'end'
export type Placement = { top: number; left: number; side: Side; maxWidth: number; maxHeight: number }
export type PlaceOptions = { side?: Side; align?: Align; gap?: number }

const OPPOSITE = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' } as const

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))

export function place(anchor: Box, size: { width: number; height: number }, area: Area, { side = 'bottom', align = 'start', gap = 4 }: PlaceOptions = {}): Placement {
  const room: Record<Side, number> = {
    bottom: area.bottom - (anchor.top + anchor.height) - gap,
    top: anchor.top - area.top - gap,
    right: area.right - (anchor.left + anchor.width) - gap,
    left: anchor.left - area.left - gap,
  }
  const vertical = (s: Side) => s === 'top' || s === 'bottom'
  const need = vertical(side) ? size.height : size.width
  const chosen = room[side] >= need || room[side] >= room[OPPOSITE[side]] ? side : OPPOSITE[side]

  const maxHeight = Math.max(0, vertical(chosen) ? room[chosen] : area.bottom - area.top)
  const maxWidth = Math.max(0, vertical(chosen) ? area.right - area.left : room[chosen])
  const width = Math.min(size.width, maxWidth)
  const height = Math.min(size.height, maxHeight)
  const along = (start: number, length: number, own: number) => (align === 'start' ? start : align === 'end' ? start + length - own : start + (length - own) / 2)

  const top = vertical(chosen) ? (chosen === 'bottom' ? anchor.top + anchor.height + gap : anchor.top - gap - height) : along(anchor.top, anchor.height, height)
  const left = vertical(chosen) ? along(anchor.left, anchor.width, width) : chosen === 'right' ? anchor.left + anchor.width + gap : anchor.left - gap - width

  return {
    top: clamp(top, area.top, area.bottom - height),
    left: clamp(left, area.left, area.right - width),
    side: chosen,
    maxWidth,
    maxHeight,
  }
}

/**
 * How many items of `widths` fit in `available` pixels with `gap` between them. When not all fit, room is kept for a
 * "more" button `more` pixels wide, so the rest can go into its menu.
 */
export function fit(widths: number[], available: number, gap: number, more: number) {
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1)
  if (total <= available) return widths.length
  let used = more
  for (let i = 0; i < widths.length; i++) {
    used += widths[i] + gap
    if (used > available) return i
  }
  return widths.length
}
