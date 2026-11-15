import { describe, expect, test } from 'bun:test'
import { fit, place } from '../src/lib/ui/place'

// A 390×844 phone screen with an 8px margin, as viewport.area() gives it.
const PHONE = { top: 8, left: 8, right: 382, bottom: 836 }
const MENU = { width: 200, height: 240 }
const at = (left: number, top: number, width = 80, height = 36) => ({ left, top, width, height })

describe('place', () => {
  test('opens below the anchor, aligned to its start, when there is room', () => {
    expect(place(at(20, 100), MENU, PHONE)).toEqual({ top: 140, left: 20, side: 'bottom', maxWidth: 374, maxHeight: 696 })
  })

  test('flips above an anchor near the bottom edge', () => {
    const placed = place(at(20, 760), MENU, PHONE)
    expect(placed.side).toBe('top')
    expect(placed.top).toBe(760 - 4 - 240)
  })

  test('stays on the roomier side and shrinks to it when it fits neither', () => {
    const tall = { width: 200, height: 900 }
    const placed = place(at(20, 300), tall, PHONE)
    expect(placed.side).toBe('bottom')
    expect(placed.maxHeight).toBe(836 - 336 - 4)
    expect(placed.top + Math.min(tall.height, placed.maxHeight)).toBeLessThanOrEqual(PHONE.bottom)
  })

  test('slides left to stay inside the right edge', () => {
    const placed = place(at(340, 100, 40), MENU, PHONE)
    expect(placed.left).toBe(382 - 200)
  })

  test('opens at a point, as context menus do, and keeps inside the corner', () => {
    const placed = place({ left: 380, top: 830, width: 0, height: 0 }, MENU, PHONE)
    expect(placed.side).toBe('top')
    expect(placed.left + MENU.width).toBeLessThanOrEqual(PHONE.right)
    expect(placed.top).toBeGreaterThanOrEqual(PHONE.top)
  })

  test('respects an area shrunk by an on-screen keyboard', () => {
    const typing = { ...PHONE, bottom: 500 }
    const placed = place(at(20, 420), MENU, typing)
    expect(placed.side).toBe('top')
    expect(placed.top + MENU.height).toBeLessThanOrEqual(420)
  })

  test('end and center alignment', () => {
    expect(place(at(200, 100), MENU, PHONE, { align: 'end' }).left).toBe(200 + 80 - 200)
    expect(place(at(150, 100), MENU, PHONE, { align: 'center' }).left).toBe(150 + 40 - 100)
  })

  test('side placement flips from right to left', () => {
    const placed = place(at(300, 100), MENU, PHONE, { side: 'right' })
    expect(placed.side).toBe('left')
    expect(placed.left).toBe(300 - 4 - 200)
  })
})

describe('fit', () => {
  test('everything fits: no more button needed', () => {
    expect(fit([60, 60, 60], 188, 4, 40)).toBe(3)
  })

  test('keeps room for the more button when not everything fits', () => {
    // 60 + 4 + 60 + 4 + 40 = 168 fits; a third key would need 232.
    expect(fit([60, 60, 60, 60], 200, 4, 40)).toBe(2)
  })

  test('a row too narrow for any key shows only more', () => {
    expect(fit([120, 60], 100, 4, 40)).toBe(0)
  })

  test('no items', () => {
    expect(fit([], 100, 4, 40)).toBe(0)
  })
})
