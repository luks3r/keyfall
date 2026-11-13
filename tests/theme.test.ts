import { expect, test } from 'bun:test'
import { normalizeTheme, resolveTheme } from '../src/lib/theme'
test('invalid preference falls back to system', () => {
  for (const value of [undefined, null, 'sepia', 1, {}]) expect(normalizeTheme(value)).toBe('system')
})
test('explicit preference overrides platform', () => {
  for (const dark of [true, false]) {
    expect(resolveTheme('light', dark)).toBe('light')
    expect(resolveTheme('dark', dark)).toBe('dark')
  }
})
test('system follows platform', () => {
  expect(resolveTheme('system', false)).toBe('light')
  expect(resolveTheme('system', true)).toBe('dark')
})
