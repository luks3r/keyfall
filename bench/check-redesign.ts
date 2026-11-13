import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withPage } from './chrome'
const suite = process.argv.find(a => a.startsWith('--suite='))?.split('=')[1] ?? 'all'
const shots = process.argv.find(a => a.startsWith('--shots='))?.slice(8) ?? tmpdir()
mkdirSync(shots, { recursive: true })
let failures = 0
function check(name: string, ok: unknown) { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failures++ }
await withPage('/', async ({ ev, call, errors }) => {
  const pause = () => Bun.sleep(250)
  const click = async (selector: string) => { await ev(`document.querySelector(${JSON.stringify(selector)})?.click()`); await pause() }
  const key = async (code: string, key: string, extra = {}) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', code, key, ...extra })
    await call('Input.dispatchKeyEvent', { type: 'keyUp', code, key, ...extra })
    await pause()
  }
  const run = (name: string) => suite === name || suite === 'all'
  await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
  await ev(`localStorage.clear(); localStorage.setItem('keyfall.settings.v2', JSON.stringify({workspace:'studio',theme:'light',audioDelay:0})); location.reload()`)
  await Bun.sleep(1200)
  if (run('theme')) {
    check('explicit light theme before and after mount', await ev(`document.documentElement.dataset.theme === 'light'`))
    const before = await ev(`document.querySelector('canvas')?.getContext('2d')?.getImageData(1,1,1,1).data.join(',')`)
    const project = await ev(`localStorage.getItem('keyfall.project.v1')`)
    await click('[aria-label="Settings"]')
    await ev(`(() => { const s = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'dark')); if(s){s.value='dark';s.dispatchEvent(new Event('change',{bubbles:true}))} })()`)
    await pause()
    check('settings changes resolved dark theme', await ev(`document.documentElement.dataset.theme === 'dark'`))
    await click('[aria-label="Close"]')
    const after = await ev(`document.querySelector('canvas')?.getContext('2d')?.getImageData(1,1,1,1).data.join(',')`)
    check('canvas repaints theme', before !== after)
    check('theme does not change project', project === await ev(`localStorage.getItem('keyfall.project.v1')`))
    await ev(`location.reload()`); await Bun.sleep(800)
    check('dark preference persists', await ev(`document.documentElement.dataset.theme === 'dark'`))
    await call('Emulation.setEmulatedMedia', { features: [{ name:'prefers-color-scheme', value:'light' }] })
    check('explicit dark overrides platform', await ev(`document.documentElement.dataset.theme === 'dark'`))
    await click('[aria-label="Settings"]')
    await ev(`(() => { const s = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'system')); s.value='system';s.dispatchEvent(new Event('change',{bubbles:true})) })()`)
    await pause()
    check('system preference follows light', await ev(`document.documentElement.dataset.theme === 'light'`))
    await call('Emulation.setEmulatedMedia', { features: [{ name:'prefers-color-scheme', value:'dark' }] }); await pause()
    check('system preference follows live dark change', await ev(`document.documentElement.dataset.theme === 'dark'`))
    await click('[aria-label="Close"]')
  }
  if (run('focus') || run('menus')) {
    await click('[aria-label="Settings"]')
    check('settings exposes a modal dialog', await ev(`!!document.querySelector('[role="dialog"][aria-modal="true"]')`))
    await ev(`document.querySelector('[role="dialog"] input')?.focus()`)
    const initial = await ev(`document.querySelector('[aria-label="Position"]')?.textContent`)
    await key('Enter', 'Enter')
    check('Enter in controls does not record', await ev(`document.querySelector('[aria-label="Stop recording"]') === null`))
    await key('Escape', 'Escape')
    check('Escape closes modal', await ev(`!document.querySelector('[role="dialog"]')`))
    await ev(`document.querySelector('[aria-label="Tempo"]')?.focus()`)
    await key('ArrowUp', 'ArrowUp')
    check('native number field retains focus', await ev(`document.activeElement?.getAttribute('aria-label') === 'Tempo'`))
    await ev(`document.querySelector('[data-performance-surface]')?.focus()`)
    await key('Tab', 'Tab')
    check('explicit performance Tab toggles launch', await ev(`!!document.querySelector('[aria-label="Studio"]')?.textContent?.includes('Keys: Launch') || !!document.querySelector('[aria-label="Clip Launch mode (Tab on keyboard)"][aria-pressed="true"]')`))
    await key('Tab', 'Tab')
    await key('Escape', 'Escape')
    await key('Tab', 'Tab')
    check('ordinary Tab leaves performance and navigates', await ev(`!document.activeElement?.matches('[data-performance-surface]')`))
  }
  await Bun.write(join(shots, `redesign-${suite}.png`), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'))
  check('no browser errors', errors.length === 0)
  if (errors.length) console.error(errors.join('\n'))
})
process.exit(failures ? 1 : 0)
