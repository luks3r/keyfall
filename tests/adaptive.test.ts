import { expect,test } from 'bun:test'
import { workspaceMode, sanitizeLayout } from '../src/lib/ui/adaptive'
test('wide requires enough height and width',()=>{
  for(const [w,h] of [[390,844],[844,390],[768,1024],[1099,900],[1400,759]])expect(workspaceMode(w,h)).toBe('focused')
  for(const [w,h] of [[1280,800],[1920,1080],[1100,760]])expect(workspaceMode(w,h)).toBe('wide')
})
test('layout preserves valid choices and rejects malformed values',()=>{
  const value=sanitizeLayout({sizes:{ok:300,bad:Infinity,negative:-1},zones:{steps:'side',fake:'side',notes:'weird'},open:{a:true,b:1},active:{bottom:'notes',side:'fake'}})
  expect(value.sizes).toEqual({ok:300});expect(value.zones).toEqual({steps:'side'})
  expect(value.open).toEqual({a:true});expect(value.active).toEqual({bottom:'notes'})
  expect(sanitizeLayout(null).sizes).toEqual({})
})
