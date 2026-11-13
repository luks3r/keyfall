import { describe, expect, test } from 'bun:test'
import { formatKeys, matches } from '../src/lib/device/combo'
import { choiceKnob, parseNumber, percentKnob, rangeKnob } from '../src/lib/device/knob-specs'
import { isMac } from '../src/lib/platform/os'

describe('knob specs', () => {
  test('range knobs snap, reset and read typed values', () => {
    let tempo = 120
    const knob = rangeKnob('Tempo', 40, 240, () => tempo, (v) => (tempo = v), (v) => `${v} bpm`, { initial: 120, step: 1 })
    knob.set(0.5013)
    expect(tempo).toBe(140)
    knob.set(knob.initial!)
    expect(tempo).toBe(120)
    expect(knob.parse!('96 bpm')).toBeCloseTo((96 - 40) / 200)
    expect(knob.parse!('999')).toBe(1)
    expect(knob.parse!('fast')).toBeNull()
    expect(knob.nudge).toBeCloseTo(1 / 200)
  })

  test('percent knobs take whole percentages', () => {
    let level = 0.5
    const knob = percentKnob('Level', () => level, (v) => (level = v), 0.8)
    expect(knob.display()).toBe('50%')
    knob.set(knob.parse!('80%')!)
    expect(level).toBeCloseTo(0.8)
    expect(knob.initial).toBeCloseTo(0.8)
  })

  test('choice knobs match typed names exactly, then by prefix, then anywhere', () => {
    let scale = 'chromatic'
    const choices = ['chromatic', 'major', 'minor', 'dorian']
    const knob = choiceKnob('Scale', choices, () => scale, (v) => (scale = v), String, 'chromatic')
    expect(knob.parse!('minor')).toBeCloseTo(2 / 3)
    expect(knob.parse!('Dor')).toBe(1)
    expect(knob.parse!('jor')).toBeCloseTo(1 / 3)
    expect(knob.parse!('lydian')).toBeNull()
    expect(knob.initial).toBe(0)
  })

  test('numbers read with signs, decimals and k', () => {
    expect(parseNumber('-3 st')).toBe(-3)
    expect(parseNumber('.5')).toBe(0.5)
    expect(parseNumber('1.2k')).toBe(1200)
    expect(parseNumber('open')).toBeNull()
  })
})

describe('key combos', () => {
  const key = (code: string, mods: Partial<KeyboardEvent> = {}) =>
    ({ code, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, ...mods }) as KeyboardEvent
  const mod = isMac ? { metaKey: true } : { ctrlKey: true }

  test('match exactly, modifiers included', () => {
    expect(matches('Mod+Z', key('KeyZ', mod))).toBe(true)
    expect(matches('Mod+Z', key('KeyZ', { ...mod, shiftKey: true }))).toBe(false)
    expect(matches('Mod+Shift+Z', key('KeyZ', { ...mod, shiftKey: true }))).toBe(true)
    expect(matches('Alt+←', key('ArrowLeft', { altKey: true }))).toBe(true)
    expect(matches('Mod+/', key('Slash', mod))).toBe(true)
    expect(matches('Shift+Enter', key('Enter'))).toBe(false)
  })

  test('format for the platform', () => {
    expect(formatKeys('Mod+Shift+Z')).toBe(isMac ? '⌘⇧Z' : 'Ctrl+Shift+Z')
  })
})
