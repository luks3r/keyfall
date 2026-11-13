import { expect, test } from 'bun:test'
import { classifyScope } from '../src/lib/input/focus'
test('controls and overlays take precedence over musical surfaces', () => {
  expect(classifyScope({ control: true, declared: 'performance' })).toBe('ui')
  expect(classifyScope({ control: true, declared: 'arrangement', clip: true })).toBe('arrangement')
  expect(classifyScope({ editing: true, declared: 'arrangement', clip: true })).toBe('ui')
  expect(classifyScope({ declared: 'arrangement' })).toBe('arrangement')
  expect(classifyScope({})).toBe('performance')
})
