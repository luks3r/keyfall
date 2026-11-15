// End-to-end check of the UI library's gallery (#ui) in headless Chrome, on a desktop window with a mouse and on a
// phone with touch: sizes follow the pointer, menus stay on screen (or open as sheets), the toolbar folds into More,
// holding a finger opens context menus, and nothing scrolls sideways. Screenshots go to the given directory.
//   bun bench/check-ui.ts [screenshot-dir]
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withPage, type Page } from './chrome'

const SHOTS = process.argv[2] ?? tmpdir()

let failures = 0
function expect(label: string, ok: unknown, detail: unknown = '') {
  if (!ok) failures++
  console.log(`${ok ? '✓' : '✗'} ${label}${detail === '' ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

type Rect = { x: number; y: number; width: number; height: number; right: number; bottom: number }

await withPage('/#ui', async ({ call, ev, errors }: Page) => {
  const shot = async (name: string) => Bun.write(join(SHOTS, name), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'))
  const size = async (width: number, height: number, mobile = false) => {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile })
    await call('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 })
    await call('Emulation.setEmitTouchEventsForMouse', { enabled: mobile, configuration: 'mobile' })
    await ev('location.reload()')
    await Bun.sleep(1500)
  }
  const rect = (selector: string) =>
    ev<Rect | null>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } })()`)
  const button = (label: string) =>
    ev<Rect | null>(`(() => { const e = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)} || b.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } })()`)
  /** Scrolls only the gallery: scrollIntoView would also shift the page, which never scrolls for a person. */
  const scrollTo = async (selector: string, where: 'center' | 'end') => {
    await ev(`(() => { const main = document.querySelector('main'), e = document.querySelector(${JSON.stringify(selector)}); const r = e.getBoundingClientRect(); main.scrollTop += ${where === 'center' ? "r.top + r.height / 2 - innerHeight / 2" : 'r.bottom - innerHeight + 8'} })()`)
    await Bun.sleep(200)
  }
  const mid = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  const click = async (r: Rect | null, button = 'left') => {
    if (!r) return
    const { x, y } = mid(r)
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: button === 'left' ? 1 : 2, clickCount: 1 })
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 })
    await Bun.sleep(200)
  }
  const tap = async (r: Rect | null, holdMs = 0) => {
    if (!r) return
    const { x, y } = mid(r)
    await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await Bun.sleep(holdMs || 40)
    await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await Bun.sleep(300)
  }
  const key = async (code: string, key: string) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code, key })
    await Bun.sleep(150)
  }
  const viewport = () => ev<{ width: number; height: number }>('({ width: innerWidth, height: innerHeight })')
  const inside = (r: Rect | null, v: { width: number; height: number }) => !!r && r.x >= 0 && r.y >= 0 && r.right <= v.width && r.bottom <= v.height
  const heights = (selector: string) => ev<number[]>(`[...new Set([...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => Math.round(e.getBoundingClientRect().height)))]`)
  const noSideScroll = () => ev<boolean>('document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll("main")].every((m) => m.scrollWidth <= m.clientWidth)')
  const theme = async (name: 'light' | 'dark') => {
    await click(await button(name === 'light' ? 'Light' : 'Dark'))
    await Bun.sleep(150)
  }

  // Desktop, mouse.
  await size(1280, 800)
  expect('gallery opens at #ui', (await ev("document.querySelector('main')?.getAttribute('aria-label')")) === 'UI library')
  expect('mouse sizes: buttons 36px, small 28px', (await heights('main button[data-ui].h-control')).join() === '36' && (await heights('main button[data-ui].h-control-sm')).join() === '28', [await heights('main button[data-ui].h-control'), await heights('main button[data-ui].h-control-sm')])

  let v = await viewport()
  await scrollTo('[data-testid=hold-target]', 'center')
  await Bun.sleep(200)
  await click(await button('Top left'))
  const below = await rect('[role=menu]')
  const topLeft = await button('Top left')
  expect('a menu opens below its button', below && topLeft && below.y >= topLeft.bottom, below)
  expect('…takes focus on its first row', (await ev('document.activeElement?.textContent?.trim()')) === 'Duplicate')
  await key('Escape', 'Escape')
  expect('Escape closes it and gives focus back', !(await rect('[role=menu]')) && (await ev('document.activeElement?.textContent?.trim()')) === 'Top left')

  await scrollTo('[data-testid=menu-box]', 'end')
  await Bun.sleep(200)
  const bottomRight = await button('Bottom right')
  await click(bottomRight)
  const flipped = await rect('[role=menu]')
  expect('near the bottom edge it flips above, fully on screen', flipped && bottomRight && flipped.bottom <= bottomRight.y && inside(flipped, v), flipped)
  await key('Escape', 'Escape')

  await click(await rect('[data-testid=hold-target]'), 'right')
  const context = await rect('[role=menu]')
  expect('right-click opens a context menu at the pointer', inside(context, v) && (await ev("document.querySelector('[role=menu]')?.dataset.presentation")) === 'popover', context)
  await key('Escape', 'Escape')

  await ev("document.querySelector('[data-testid=toolbar-box]').style.width = '240px'")
  await Bun.sleep(300)
  const row = await rect('[aria-label="Gallery actions"]')
  const keys = await ev<Rect[]>(`[...document.querySelectorAll('[aria-label="Gallery actions"] > button')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, right: r.right } })`)
  expect('a narrow toolbar folds the rest into More', !!(await button('More actions')) && keys.length < 9 && keys.every((k) => row && k.right <= row.right), keys.length)
  await click(await button('More actions'))
  const folded = await ev<string[]>("[...document.querySelectorAll('[role=menu] button')].map((b) => b.textContent.trim())")
  expect('…which lists the keys that did not fit', folded.includes('Quantize') && folded.at(-1) === 'Record', folded)
  await click(await button('Quantize'))
  expect('…and runs them', ((await ev("document.querySelector('[aria-live]')?.textContent")) as string).startsWith('Quantize'))
  await ev("document.querySelector('[data-testid=toolbar-box]').style.width = ''")
  await Bun.sleep(300)
  expect('wide again, every key shows', !(await button('More actions')))

  await ev('document.querySelector("main").scrollTo(0, 0)')
  await shot('ui-desktop-dark.png')
  await theme('light')
  await shot('ui-desktop-light.png')
  await theme('dark')

  // Phone, touch.
  await size(390, 844, true)
  v = await viewport()
  expect('touch screens match pointer: coarse', await ev("matchMedia('(pointer: coarse)').matches"))
  expect('touch sizes: buttons 44px, small 40px', (await heights('main button[data-ui].h-control')).join() === '44' && (await heights('main button[data-ui].h-control-sm')).join() === '40', [await heights('main button[data-ui].h-control'), await heights('main button[data-ui].h-control-sm')])
  expect('nothing scrolls sideways', await noSideScroll())
  const phoneKeys = await ev<number>(`document.querySelectorAll('[aria-label="Gallery actions"] > button').length`)
  expect('the toolbar fits the phone by folding into More', !!(await button('More actions')) && phoneKeys < 9, phoneKeys)

  await scrollTo('[data-testid=hold-target]', 'center')
  await Bun.sleep(200)
  await tap(await button('Top right'))
  const sheet = await rect('[role=menu]')
  expect('on a phone a menu opens as a bottom sheet', (await ev("document.querySelector('[role=menu]')?.dataset.presentation")) === 'sheet' && sheet && sheet.x === 0 && Math.round(sheet.right) === v.width && Math.round(sheet.bottom) === v.height, sheet)
  await shot('ui-phone-sheet.png')
  await tap({ x: 20, y: 20, width: 1, height: 1, right: 21, bottom: 21 })
  expect('tapping the backdrop closes it', !(await rect('[role=menu]')))
  expect('…without pressing what lies under it', ((await ev("document.querySelector('[aria-live]')?.textContent")) as string) === '—')

  await tap(await rect('[data-testid=hold-target]'), 700)
  expect('holding a finger opens the context menu', (await ev("document.querySelector('[role=menu]')?.dataset.presentation")) === 'sheet')
  await Bun.sleep(300)
  expect('…and lifting it leaves the menu open', !!(await rect('[role=menu]')))
  await tap(await button('Duplicate'))
  expect('…then a tap runs a row and closes it', !(await rect('[role=menu]')) && ((await ev("document.querySelector('[aria-live]')?.textContent")) as string).startsWith('Duplicate'))

  await tap(await rect('[data-testid=hold-target]'), 150)
  expect('a short tap is not a hold', !(await rect('[role=menu]')))

  await tap(await button('Modal panel'))
  const panel = await rect('[role=dialog]')
  expect('a modal panel rises from the bottom, full width', panel && panel.x === 0 && Math.round(panel.bottom) === v.height, panel)
  await tap({ x: 20, y: 20, width: 1, height: 1, right: 21, bottom: 21 })
  await Bun.sleep(300)
  expect('…and its backdrop closes it', !(await rect('[role=dialog]')))

  await ev('document.querySelector("main").scrollTo(0, 0)')
  await shot('ui-phone-dark.png')
  await theme('light')
  await shot('ui-phone-light.png')
  await theme('dark')

  expect('the page itself never scrolls', (await ev('document.scrollingElement.scrollTop')) === 0)
  expect('no page errors', errors.length === 0, errors)
})

console.log(failures ? `${failures} failed` : 'all passed')
process.exit(failures ? 1 : 0)
