<script lang="ts">
  import { theme } from '../theme.svelte'
  import { snap, type Clip } from './project'

  let { clip, color, zoom }: { clip: Clip; color: string; zoom: number } = $props()
  let canvas: HTMLCanvasElement

  const PADDING = 4

  $effect(() => {
    void theme.revision
    const { notes, length, repeat, quantize } = clip
    const width = Math.max(1, Math.round(length * zoom))
    const height = canvas.clientHeight
    const dpr = devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    if (!notes.length) return
    let lo = 127
    let hi = 0
    for (const { pitch } of notes) {
      lo = Math.min(lo, pitch)
      hi = Math.max(hi, pitch)
    }
    const span = Math.max(12, hi - lo + 1)
    const row = (height - PADDING * 2) / span
    const step = repeat > 0 ? repeat : length
    const variable = /^var\((--[\w-]+)\)$/.exec(color)
    ctx.fillStyle = variable ? getComputedStyle(canvas).getPropertyValue(variable[1]).trim() : color
    for (let offset = 0; offset < length; offset += step) {
      ctx.globalAlpha = offset ? 0.45 : 1
      for (const note of notes) {
        const start = snap(note.start, quantize)
        if (start >= step || offset + start >= length) continue
        const y = height - PADDING - (note.pitch - lo + 1) * row
        ctx.fillRect((offset + start) * zoom, y, Math.max(1.5, Math.min(note.length, length - offset - start) * zoom), Math.max(1.5, row - 0.5))
      }
    }
  })
</script>

<canvas bind:this={canvas} class="pointer-events-none absolute inset-0 h-full" style:width="{clip.length * zoom}px"></canvas>
