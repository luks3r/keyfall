<script lang="ts" module>
  export const TRACK_COLORS = Array.from({ length: 8 }, (_, i) => `var(--color-track-${i + 1})`)
  export const trackColor = (index: number) => TRACK_COLORS[index % TRACK_COLORS.length]
</script>
<script lang="ts">
  import { preserveScroll } from '../ui/adaptive'
  import { tick } from 'svelte'
  import { MediaQuery } from 'svelte/reactivity'
  import Button from '../ui/Button.svelte'
  import Menu from '../ui/Menu.svelte'
  import Select from '../ui/Select.svelte'
  import { scopeForTarget } from '../input/focus'
  import { inputFocus } from '../input/focus.svelte'
  import { layout } from '../ui/layout.svelte'
  import { STUDIO_PANELS } from './panels'
  import ClipPreview from './ClipPreview.svelte'
  import { gridFor, overlaps, resizeBounds, type ArrangementSnap } from './arrangement'
  import { projectEnd, type Clip, type Project, type Track } from './project'
  import { studio } from './studio.svelte'
  const compact = new MediaQuery('(max-width: 639px)')
  const coarse = new MediaQuery('(pointer: coarse)')
  const ZOOMS = [8,12,16,24,32,48,64]
  let zoomIndex = $state(3)
  let scroller: HTMLDivElement
  const zoom = $derived(ZOOMS[zoomIndex])
  const header = $derived(compact.current ? 124 : 184)
  const project = $derived(studio.project)
  const bar = $derived(project.beatsPerBar)
  const grid = $derived(gridFor(studio.arrangementSnap, bar))
  const beats = $derived(Math.ceil(projectEnd(project) / bar) * bar + 8 * bar)
  const width = $derived(beats * zoom)
  type Bounds = {start:number;length:number;repeat:number}
  type Drag = {kind:'move'|'resize'|'loop-move'|'loop-start'|'loop-end';pointerId:number;x:number;original:Bounds;proposed:Bounds;project:Project;trackId?:string;clipId?:string; moved:boolean;target:HTMLElement}
  let drag = $state<Drag|null>(null)
  let suppressClick = false
  type Target = {kind:'clip';trackId:string;clipId:string}|{kind:'lane';trackId:string;beat:number}|{kind:'track';trackId:string}
  let menu = $state<{target:Target;point:{x:number;y:number};anchor:HTMLElement}|null>(null)
  const menuTrack = $derived(project.tracks.find(t => t.id === menu?.target.trackId))
  const menuClip = $derived(menu?.target.kind === 'clip' ? menuTrack?.clips.find(c => c.id === (menu!.target as {clipId:string}).clipId) : undefined)
  const at = (e: MouseEvent|PointerEvent, element:HTMLElement) => Math.max(0,Math.round((e.clientX-element.getBoundingClientRect().left)/zoom/grid)*grid)
  function cancel() {
    const old=drag;drag=null
    if(old?.target.hasPointerCapture(old.pointerId))old.target.releasePointerCapture(old.pointerId)
  }
  $effect(() => { if(drag && drag.project !== project) cancel() })
  function begin(e:PointerEvent,kind:Drag['kind'],bounds:Bounds,trackId?:string,clipId?:string) {
    if(e.button!==0)return
    e.stopPropagation();e.preventDefault()
    const target=e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    drag={kind,pointerId:e.pointerId,x:e.clientX,original:{...bounds},proposed:{...bounds},project,trackId,clipId,moved:false,target}
  }
  function move(e:PointerEvent) {
    if(!drag || e.pointerId!==drag.pointerId)return
    const delta=Math.round((e.clientX-drag.x)/zoom/grid)*grid
    if(!drag.moved && Math.abs(e.clientX-drag.x)<4)return
    drag.moved=true
    const o=drag.original
    if(drag.kind==='move'||drag.kind==='loop-move')drag.proposed={...o,start:Math.max(0,o.start+delta)}
    else if(drag.kind==='resize')drag.proposed={start:o.start,...resizeBounds({...o} as Clip,o.length+delta,grid)}
    else if(drag.kind==='loop-start'){
      const start=Math.max(0,Math.min(o.start+o.length-grid,o.start+delta))
      drag.proposed={...o,start,length:o.start+o.length-start}
    }else drag.proposed={...o,length:Math.max(grid,o.length+delta)}
  }
  function finish(e:PointerEvent) {
    const d=drag
    if(!d || d.pointerId!==e.pointerId)return
    if(d.moved && d.project===project){
      suppressClick=true
      setTimeout(()=>suppressClick=false,0)
      if(d.clipId && d.trackId)studio.setClipBounds(d.trackId,d.clipId,d.proposed.start,d.proposed.length)
      else if(d.proposed.start!==d.original.start||d.proposed.length!==d.original.length)studio.edit(p=>{p.loop.start=d.proposed.start;p.loop.end=d.proposed.start+d.proposed.length})
    }
    cancel()
  }
  function selectLane(e:MouseEvent,track:Track) {
    if(suppressClick){suppressClick=false;return}
    studio.select(track.id)
    studio.insertion={trackId:track.id,beat:at(e,e.currentTarget as HTMLElement)}
  }
  function create(trackId=studio.track?.id,beat=studio.insertion?.trackId===trackId?studio.insertion.beat:studio.position){
    if(trackId)studio.addArrangementClip(trackId,beat)
  }
  function context(e:MouseEvent,target:Target) {
    e.preventDefault();e.stopPropagation();cancel()
    menu={target,point:{x:e.clientX,y:e.clientY},anchor:e.currentTarget as HTMLElement}
  }
  function openClip(track:Track,clip:Clip) {studio.openClipEditor(track.id,clip.id)}
  function key(e:KeyboardEvent) {
    if(e.key==='Escape' && drag){e.preventDefault();e.stopPropagation();cancel();return}
    if(e.defaultPrevented||e.isComposing||e.repeat||inputFocus.blocked||scopeForTarget(e.target)!=='arrangement')return
    const clip=studio.clip,track=studio.track
    if(!clip||!track)return
    if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){
      e.preventDefault();const anchor=e.target as HTMLElement;const r=anchor.getBoundingClientRect()
      menu={target:{kind:'clip',trackId:track.id,clipId:clip.id},point:{x:r.left,y:r.bottom},anchor};return
    }
    if(e.key==='Enter'){e.preventDefault();openClip(track,clip)}
    else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();studio.removeClip(track,clip.id)}
    else if((e.metaKey||e.ctrlKey)&&e.code==='KeyD'){e.preventDefault();studio.duplicateClip(track,clip)}
  }
  function setLoop(start:number,end:number){
    if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start)studio.edit(p=>{p.loop.start=start;p.loop.end=end})
  }
  async function wheel(e:WheelEvent){
    if(!e.ctrlKey&&!e.metaKey)return
    e.preventDefault()
    const x=e.clientX-scroller.getBoundingClientRect().left
    const beat=(scroller.scrollLeft+x-header)/zoom
    zoomIndex=Math.max(0,Math.min(ZOOMS.length-1,zoomIndex+(e.deltaY<0?1:-1)))
    await tick();scroller.scrollLeft=Math.max(0,beat*zoom-x+header)
  }
</script>
<svelte:window onblur={cancel} onkeydown={(e)=>{if(e.key==='Escape'&&drag){e.preventDefault();cancel()}}} />
<!-- Keyboard commands are delegated from focusable clip controls. -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]" data-input-scope="arrangement" onkeydown={key} role="group" aria-label="Arrangement">
  <div class="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2" data-input-scope="ui">
    <span class="mr-auto font-mono text-xs text-muted">arrange</span>
    <Button onclick={()=>create()} aria-label="New arrangement clip">+ New clip</Button>
    {#if studio.clip && studio.track}<Button onclick={()=>openClip(studio.track!,studio.clip!)} aria-label="Edit selected clip">Edit clip</Button>{/if}
    <label class="flex items-center gap-2 text-xs text-muted">Snap<div class="w-24"><Select bind:value={()=>studio.arrangementSnap,v=>studio.arrangementSnap=v as ArrangementSnap} options={[{value:'bar',label:'Bar'},{value:'beat',label:'Beat'},{value:'eighth',label:'1/8'},{value:'sixteenth',label:'1/16'}]} /></div></label>
    <Button onclick={()=>zoomIndex=Math.max(0,zoomIndex-1)} aria-label="Zoom out">−</Button><Button onclick={()=>zoomIndex=Math.min(ZOOMS.length-1,zoomIndex+1)} aria-label="Zoom in">+</Button>
    <Button onclick={()=>studio.toggleLoop()} aria-pressed={project.loop.enabled}>Loop</Button>
    {#if project.loop.enabled}
      <label class="text-xs text-muted">From <input class="w-14 bg-raised px-1" type="number" aria-label="Playback loop start" min="0" value={project.loop.start} onchange={e=>{setLoop(e.currentTarget.valueAsNumber,project.loop.end);e.currentTarget.value=String(project.loop.start)}} /></label>
      <label class="text-xs text-muted">To <input class="w-14 bg-raised px-1" type="number" aria-label="Playback loop end" min="1" value={project.loop.end} onchange={e=>{setLoop(project.loop.start,e.currentTarget.valueAsNumber);e.currentTarget.value=String(project.loop.end)}} /></label>
    {/if}
    {#if studio.notice}<span class="text-xs text-muted" role="status">{studio.notice}</span>{/if}
  </div>
  <div bind:this={scroller} use:preserveScroll={'arrangement'} class="relative min-h-0 overflow-auto overscroll-contain bg-display" onwheel={wheel} onpointermove={move} onpointerup={finish} onpointercancel={cancel} onlostpointercapture={cancel} role="group" aria-label="Arrangement timeline">
    <div class="relative min-w-full" style:width="{header+width}px" style:min-height="100%">
      <div class="sticky top-0 z-20 flex h-12 border-b border-line bg-surface">
        <div class="sticky left-0 z-30 shrink-0 border-r border-line bg-surface px-3 py-3 font-mono text-xs text-muted" style:width="{header}px">track / bars</div>
        <div class="relative shrink-0" style:width="{width}px">
          <div class="absolute inset-x-0 top-0 h-4 bg-raised" aria-label="Playback loop strip" role="group">
            {#if project.loop.enabled}
              {@const loop=drag?.kind.startsWith('loop')?drag.proposed:{start:project.loop.start,length:project.loop.end-project.loop.start,repeat:0}}
              <div class="absolute inset-y-0 bg-mint/40 touch-none" style:left="{loop.start*zoom}px" style:width="{loop.length*zoom}px" role="presentation" onpointerdown={e=>begin(e,'loop-move',{start:project.loop.start,length:project.loop.end-project.loop.start,repeat:0})}>
                <span class="absolute inset-y-0 left-0 w-3 cursor-ew-resize border-l-2 border-mint" role="presentation" onpointerdown={e=>begin(e,'loop-start',{start:project.loop.start,length:project.loop.end-project.loop.start,repeat:0})}></span>
                <span class="absolute inset-y-0 right-0 w-3 cursor-ew-resize border-r-2 border-mint" role="presentation" onpointerdown={e=>begin(e,'loop-end',{start:project.loop.start,length:project.loop.end-project.loop.start,repeat:0})}></span>
              </div>
            {/if}
          </div>
          <div class="absolute inset-x-0 bottom-0 h-8 cursor-pointer" role="slider" tabindex="0" aria-label="Playhead" aria-valuemin="0" aria-valuemax={beats} aria-valuenow={studio.position} onkeydown={e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();studio.seek(Math.max(0,studio.position+(e.key==='ArrowRight'?1:-1)))}}} onpointerdown={e=>{if(e.button===0)studio.seek(Math.max(0,(e.clientX-e.currentTarget.getBoundingClientRect().left)/zoom))}}>
            {#each Array.from({length:Math.ceil(beats/bar)},(_,i)=>i) as i}<span class="pointer-events-none absolute bottom-1 border-l border-line pl-1 font-mono text-[11px] text-muted" style:left="{i*bar*zoom}px">{i+1}</span>{/each}
          </div>
        </div>
      </div>
      {#each project.tracks as track,index (track.id)}
        {@const color=trackColor(index)}
        <div class="flex border-b border-line" style:height={coarse.current?'76px':'64px'}>
          <div class="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line bg-surface px-2" style:width="{header}px" style:border-left="3px solid {color}" oncontextmenu={e=>context(e,{kind:'track',trackId:track.id})} role="group" aria-label={track.name}>
            <button type="button" class="min-w-0 flex-1 truncate text-left text-xs" aria-pressed={studio.track?.id===track.id} onclick={()=>studio.select(track.id)}>{track.name}</button>
            <button type="button" class="w-7 text-xs" aria-label="Mute {track.name}" aria-pressed={track.muted} onclick={()=>studio.edit(()=>track.muted=!track.muted)}>M</button>
            <button type="button" class="w-7 text-xs" aria-label="Solo {track.name}" aria-pressed={track.solo} onclick={()=>studio.edit(()=>track.solo=!track.solo)}>S</button>
          </div>
          <div data-track-lane class="relative shrink-0" style:width="{width}px" style:background-image="repeating-linear-gradient(90deg,var(--color-grid-strong) 0 1px,transparent 1px {bar*zoom}px),repeating-linear-gradient(90deg,var(--color-grid-faint) 0 1px,transparent 1px {grid*zoom}px)" onclick={e=>selectLane(e,track)} ondblclick={e=>{e.stopPropagation();create(track.id,at(e,e.currentTarget))}} oncontextmenu={e=>context(e,{kind:'lane',trackId:track.id,beat:at(e,e.currentTarget)})} role="presentation">
            {#if studio.insertion?.trackId===track.id}<span class="pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed border-mint" style:left="{studio.insertion.beat*zoom}px"></span>{/if}
            {#each track.clips as clip (clip.id)}
              {@const active=studio.clip?.id===clip.id}
              {@const preview=drag?.clipId===clip.id?drag.proposed:clip}
              {@const collision=drag?.clipId===clip.id&&overlaps(track.clips,preview.start,preview.length,clip.id)}
              {#if drag?.clipId===clip.id}<span class="pointer-events-none absolute inset-y-1 border border-dashed border-muted" style:left="{clip.start*zoom}px" style:width="{clip.length*zoom}px"></span>{/if}
              <div data-arrangement-clip data-input-scope="arrangement" class={['absolute inset-y-1 overflow-hidden rounded border',active&&'ring-2 ring-fg',!coarse.current&&'touch-none cursor-grab']} style:left="{preview.start*zoom}px" style:width="{preview.length*zoom}px" style:background="color-mix(in srgb,{color} 20%,var(--color-display))" style:border-color={collision?'var(--color-danger)':color} role="button" tabindex="0" onkeydown={e=>{if(e.key===' '){e.preventDefault();studio.select(track.id,clip.id)}}} aria-label="Clip on {track.name} at beat {clip.start}" onfocus={()=>studio.select(track.id,clip.id)} onclick={e=>{e.stopPropagation();if(suppressClick){suppressClick=false;return}studio.select(track.id,clip.id)}} ondblclick={e=>{e.stopPropagation();if(!suppressClick)openClip(track,clip)}} onpointerdown={e=>{if(e.button!==0)return;studio.select(track.id,clip.id);if(!coarse.current)begin(e,'move',clip,track.id,clip.id)}} oncontextmenu={e=>context(e,{kind:'clip',trackId:track.id,clipId:clip.id})}>
                <ClipPreview {clip} {color} {zoom} />
                <span class="pointer-events-none absolute top-1 left-2 font-mono text-[10px] text-fg">{drag?.clipId===clip.id?`${preview.start} · ${preview.length} beats${collision?' · overlap':''}`:`${clip.notes.length} notes`}</span>
                {#if active && (!coarse.current||preview.length*zoom>=96)}
                  {#if coarse.current}<button type="button" class="absolute left-0 bottom-0 w-11 bg-raised/80 text-xs touch-none" aria-label="Move selected clip" onpointerdown={e=>begin(e,'move',clip,track.id,clip.id)} onclick={e=>e.stopPropagation()}>↔</button>{/if}
                  <button type="button" class={['absolute inset-y-0 right-0 touch-none cursor-ew-resize border-l border-fg/50',coarse.current?'w-11 bg-raised/80':'w-3']} aria-label="Resize selected clip" onpointerdown={e=>begin(e,'resize',clip,track.id,clip.id)} onclick={e=>e.stopPropagation()}></button>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
      <div class="pointer-events-none absolute top-4 bottom-0 z-20 w-px bg-playhead" style:left="{header+studio.position*zoom}px"></div>
    </div>
  </div>
</div>
{#if menu}
  <Menu point={menu.point} returnFocus={menu.anchor} onclose={()=>menu=null}>
    {#if menuTrack && menuClip}
      <button type="button" role="menuitem" onclick={()=>studio.openClipEditor(menuTrack!.id,menuClip!.id,'steps')}>Edit in Steps</button>
      <button type="button" role="menuitem" onclick={()=>studio.openClipEditor(menuTrack!.id,menuClip!.id,'notes')}>Edit in Notes</button>
      <button type="button" role="menuitem" onclick={()=>studio.duplicateClip(menuTrack!,menuClip!)}>Duplicate</button>
      <button type="button" role="menuitem" onclick={()=>studio.loopClip(menuTrack!.id,menuClip!.id)}>Set Playback Loop to Clip</button>
      <button type="button" role="menuitem" data-destructive onclick={()=>studio.removeClip(menuTrack!,menuClip!.id)}>Delete Clip</button>
    {:else if menuTrack && menu.target.kind==='lane'}
      <button type="button" role="menuitem" onclick={()=>{if(menu?.target.kind==='lane')create(menu.target.trackId,menu.target.beat)}}>New Clip Here</button>
    {:else if menuTrack && menu.target.kind==='track'}
      <button type="button" role="menuitem" onclick={()=>{studio.select(menuTrack!.id);layout.show(STUDIO_PANELS,'track')}}>Track Settings</button>
      <button type="button" role="menuitem" onclick={()=>studio.edit(()=>menuTrack!.muted=!menuTrack!.muted)}>{menuTrack.muted?'Unmute':'Mute'}</button>
      <button type="button" role="menuitem" onclick={()=>studio.edit(()=>menuTrack!.solo=!menuTrack!.solo)}>{menuTrack.solo?'Unsolo':'Solo'}</button>
    {/if}
  </Menu>
{/if}
