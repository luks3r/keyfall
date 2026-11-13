export const workspaceMode = (width: number, height: number): 'wide'|'focused' => width >= 1100 && height >= 760 ? 'wide' : 'focused'
export type LayoutState = {sizes:Record<string,number>;zones:Record<string,'side'|'bottom'>;active:Partial<Record<'side'|'bottom',string>>;open:Record<string,boolean>}
const panels = new Set(['steps','notes','pads','track','keyboard'])
export function sanitizeLayout(value: unknown): LayoutState {
  const result:LayoutState={sizes:{},zones:{},active:{},open:{}}
  if(!value||typeof value!=='object')return result
  const source=value as Record<string,unknown>
  const entries=(key:string)=>source[key]&&typeof source[key]==='object'?Object.entries(source[key] as object):[]
  for(const [key,v] of entries('sizes'))if(typeof v==='number'&&Number.isFinite(v)&&v>0)result.sizes[key]=v
  for(const [key,v] of entries('zones'))if(panels.has(key)&&(v==='side'||v==='bottom'))result.zones[key]=v
  for(const [key,v] of entries('active'))if((key==='side'||key==='bottom')&&typeof v==='string'&&panels.has(v))result.active[key]=v
  for(const [key,v] of entries('open'))if(typeof v==='boolean')result.open[key]=v
  return result
}
const scrolls=new Map<string,{left:number;top:number}>()
export function restoreScroll(node:HTMLElement,key:string) {
  const value=scrolls.get(key)
  if(!value)return false
  if(node.clientWidth && node.clientHeight){node.scrollLeft=value.left;node.scrollTop=value.top}
  return true
}
export function preserveScroll(node:HTMLElement,key:string) {
  let current=key
  let restored=false
  const save=()=>{if(node.clientWidth&&node.clientHeight)scrolls.set(current,{left:node.scrollLeft,top:node.scrollTop})}
  const observer=new ResizeObserver(()=>{
    if(node.clientWidth&&node.clientHeight&&!restored){restoreScroll(node,current);restored=true}
  })
  observer.observe(node)
  node.addEventListener('scroll',save,{passive:true})
  return {
    update(next:string){if(next!==current){save();current=next;restored=false;queueMicrotask(()=>{if(node.clientWidth&&node.clientHeight){restoreScroll(node,current);restored=true}})}},
    destroy(){save();observer.disconnect();node.removeEventListener('scroll',save)},
  }
}
