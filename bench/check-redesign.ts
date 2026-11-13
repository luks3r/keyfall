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
  const reset = async (workspace='studio', view='session') => {
    await ev(`localStorage.clear(); localStorage.setItem('keyfall.settings.v2',JSON.stringify({workspace:${JSON.stringify(workspace)},theme:'light',audioDelay:0}));localStorage.setItem('keyfall.studio.v1',JSON.stringify({view:${JSON.stringify(view)},metronome:false,countIn:false}));location.reload()`)
    await Bun.sleep(900)
  }
  const shot = async (name: string) => Bun.write(join(shots,name+'.png'), Buffer.from((await call('Page.captureScreenshot')).data,'base64'))
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
  if (run('arrangement')) {
    await ev(`(() => { const p=JSON.parse(localStorage.getItem('keyfall.project.v1')); p.tracks[0].clips=[{id:'test-clip',start:0,length:4,repeat:4,quantize:0,notes:[{pitch:60,start:0,length:1,velocity:1}]}]; localStorage.setItem('keyfall.project.v1',JSON.stringify(p)); localStorage.setItem('keyfall.studio.v1',JSON.stringify({view:'arrange',metronome:false,countIn:false})); location.reload() })()`)
    await Bun.sleep(1000)
    check('arrangement exposes explicit New Clip', await ev(`!!document.querySelector('[aria-label="New arrangement clip"]')`))
    const lane = await ev(`(() => {const e=document.querySelector('[data-track-lane]');const r=e?.getBoundingClientRect();return r?{x:r.x+240,y:r.y+30}:null})()`)
    if (lane) {
      for(let i=0;i<2;i++){ await call('Input.dispatchMouseEvent',{type:'mousePressed',...lane,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...lane,button:'left',buttons:0,clickCount:1}) }
      await Bun.sleep(600)
      check('lane selection does not create music',await ev(`JSON.parse(localStorage.getItem('keyfall.project.v1')).tracks[0].clips.length===1`))
    }
    const rect=await ev(`(() => {const r=document.querySelector('[data-arrangement-clip]')?.getBoundingClientRect();return r?{x:r.x+20,y:r.y+20}:null})()`)
    if(rect){await call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'right',buttons:2});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'right',buttons:0});await pause()}
    check('right click opens contextual clip actions',await ev(`!!document.querySelector('[role="menu"]')`))
    await key('ArrowDown','ArrowDown')
    check('context menu arrows move focus',await ev(`document.activeElement?.textContent==='Edit in Notes'`))
    await key('Escape','Escape')
    check('context dismissal preserves clip position',await ev(`JSON.parse(localStorage.getItem('keyfall.project.v1')).tracks[0].clips[0].start===0`))
    if(rect) {
      await call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',buttons:1})
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+96,y:rect.y,button:'left',buttons:1})
      await key('Escape','Escape')
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+96,y:rect.y,button:'left',buttons:0})
      await Bun.sleep(600)
      check('Escape cancels clip movement without changing music',await ev(`JSON.parse(localStorage.getItem('keyfall.project.v1')).tracks[0].clips[0].start===0`))
      await call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',buttons:1})
      await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x+96,y:rect.y,button:'left',buttons:1})
      await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x+96,y:rect.y,button:'left',buttons:0})
      await Bun.sleep(600)
      check('drag commits snapped position',await ev(`JSON.parse(localStorage.getItem('keyfall.project.v1')).tracks[0].clips[0].start===4`))
      await ev(`document.querySelector('[data-arrangement-clip]')?.focus()`)
      await key('KeyZ','z',{modifiers:2}); await Bun.sleep(600)
      check('one undo restores clip bounds',await ev(`JSON.parse(localStorage.getItem('keyfall.project.v1')).tracks[0].clips[0].start===0`))
      await key('KeyD','d',{modifiers:2}); await Bun.sleep(600)
      check('focused duplicate creates independent clip after source',await ev(`(() => {const c=JSON.parse(localStorage.getItem('keyfall.project.v1')).tracks[0].clips;return c.length===2&&c[1].id!==c[0].id&&c[1].start===4})()`))
      await click('[aria-label="Edit selected clip"]')
      await ev(`(() => {const e=document.querySelector('[aria-label="Clip length beats"]');if(e){e.value='2';e.dispatchEvent(new Event('change',{bubbles:true}))}})()`)
      await Bun.sleep(600)
      check('precise resize preserves source notes',await ev(`(() => {const c=JSON.parse(localStorage.getItem('keyfall.project.v1')).tracks[0].clips;return c[0].length===4&&c[1].length===2&&c[1].notes.length===1})()`))
      check('clip preview uses colored pixels', await ev(`(() => {const c=document.querySelector('[data-arrangement-clip] canvas');if(!c)return false;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return [...d].some((v,i)=>i%4!==3&&v>0)})()`))
      await shot('arrangement-light')
      await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
      await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await pause()
      await ev(`[...document.querySelectorAll('[aria-label="Studio surfaces"] button')].find(b=>b.textContent==='Project')?.click()`);await pause()
      const snapshot=await ev(`localStorage.getItem('keyfall.project.v1')`)
      const touch=await ev(`(() => {const r=document.querySelector('[data-arrangement-clip]')?.getBoundingClientRect();return r?{x:r.x+25,y:r.y+r.height/2}:null})()`)
      if(touch){
        await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]})
        await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x-50,y:touch.y-8}]})
        await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await pause()
      }
      check('touch scrolling does not alter clips',snapshot===await ev(`localStorage.getItem('keyfall.project.v1')`))
      await shot('arrangement-touch')
      await call('Emulation.setTouchEmulationEnabled',{enabled:false})
      await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await pause()

    }

  }
  if (run('studio')) {
    await reset()
    await click('[aria-label="Create session clip"]')
    check('selected clip exposes visible Edit', await ev(`!!document.querySelector('[aria-label="Edit selected clip"]')`))
    await click('[aria-label="Edit selected clip"]')
    check('new clip defaults to Steps', await ev(`!!document.querySelector('[aria-label="Step grid"]')`))
    await click('[aria-label="Edit in Notes"]')
    check('visible Notes action opens note editor', await ev(`!!document.querySelector('[aria-label="Note grid"]')`))
  }
  if (run('focus') || run('menus')) {
    await reset()
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
  if(run('adaptive')) {
    await reset()
    for(const [width,height] of [[390,844],[844,390],[768,1024],[1280,800],[1920,1080]]) {
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000})
      await call('Emulation.setTouchEmulationEnabled',{enabled:width<1000,maxTouchPoints:1})
      await pause()
      check(`no chrome overflow ${width}×${height}`,await ev(`document.documentElement.scrollWidth <= innerWidth`))
      check(`transport visible ${width}×${height}`,await ev(`(() => {const e=document.querySelector('[aria-label="Play"] button[title="Play / Stop (Space)"], button[title="Play / Stop (Space)"]');const r=e?.getBoundingClientRect();return !!r&&r.width>0&&r.x>=0&&r.right<=innerWidth})()`))
      if(width<1100||height<760) {
        await ev(`[...document.querySelectorAll('[aria-label="Studio surfaces"] button')].find(b=>b.textContent==='Play')?.click()`);await pause()
        check(`performance reachable ${width}×${height}`,await ev(`(() => {const e=document.querySelector('[data-performance-surface]');return !!e&&e.getBoundingClientRect().height>40})()`))
        await ev(`[...document.querySelectorAll('[aria-label="Studio surfaces"] button')].find(b=>b.textContent==='Project')?.click()`)
      }
      await shot(`studio-light-${width}x${height}`)
    }
    await call('Emulation.setTouchEmulationEnabled',{enabled:false})
    await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false})
  }
  if(run('parity')) {
    await reset('learn')
    check('Learn mounts a playable keyboard',await ev(`!!document.querySelector('[data-performance-surface]')`))
    await click('[aria-label="Settings"]')
    check('Learn uses shared theme controls',await ev(`!![...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='system'))`))
    await click('[aria-label="Close"]')
    await shot('learn-light')
    await ev(`localStorage.setItem('keyfall.settings.v2',JSON.stringify({...JSON.parse(localStorage.getItem('keyfall.settings.v2')),theme:'dark'}));location.reload()`);await Bun.sleep(900)
    check('Learn honors dark preference',await ev(`document.documentElement.dataset.theme==='dark'`))
    await shot('learn-dark')
    await reset()
    await click('[aria-label="Settings"]')
    await ev(`(() => {const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='dark'));s.value='dark';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);await pause()
    await click('[aria-label="Close"]')
    check('Studio honors selected dark theme',await ev(`document.documentElement.dataset.theme==='dark'`))
    await shot('studio-dark')
  }
  await Bun.write(join(shots, `redesign-${suite}.png`), Buffer.from((await call('Page.captureScreenshot')).data, 'base64'))
  check('no browser errors', errors.length === 0)
  if (errors.length) console.error(errors.join('\n'))
})
process.exit(failures ? 1 : 0)
