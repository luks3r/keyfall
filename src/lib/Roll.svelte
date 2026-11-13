<script lang="ts">
  import { onMount } from 'svelte'
  import { theme, readCanvasPalette } from './theme.svelte'
  import { MediaQuery } from 'svelte/reactivity'
  import { SHIFT, symbol } from './input/keymaps'
  import { Mark, type Player } from './player.svelte'
  import { clock, LOCAL } from './sandbox.svelte'
  import { settings } from './settings.svelte'
  import { handFor, lowerBound } from './song'

  let { player }: { player: Player } = $props()
  let canvas: HTMLCanvasElement

  const MIN_VELOCITY = 0.45
  /** Short strips (Studio's keyboard) still get playable keys. */
  const MIN_KEYS = 96
  const MAX_VELOCITY = 1
  const touch = new MediaQuery('pointer: coarse')
  const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false]
  let COLORS = $state({ bg: '#141514', lane: '#ffffff05', octave: '#ffffff0c', line: '#eee', white: '#eee', black: '#222', seam: '#0003', labelOnWhite: '#333', labelOnBlack: '#ccc', user: '#df9b3d', edit: '#d23b30', hands: [['#62bfa6', '#27836c'], ['#6d9fd7', '#4273a9']] })
  const HANDS = $derived(COLORS.hands)
  $effect(() => {
    void theme.revision
    if (canvas) { COLORS = readCanvasPalette(canvas); player.dirty = true }
  })

  const isBlack = (midi: number) => BLACK[midi % 12]

  $effect(() => {
    void [settings.keymap, settings.editing, settings.editTarget, settings.lookahead, settings.labels, player.root, player.mode, player.range]
    player.dirty = true
  })

  onMount(() => {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!
    const xs = new Float32Array(128)
    const ws = new Float32Array(128)
    const lit: (string | null)[] = Array(128).fill(null)
    let width = 0
    let height = 0
    let top = 0
    let blackHeight = 0
    let range: readonly [number, number] = [0, 0]

    const resize = () => {
      const dpr = devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      player.dirty = true
    }

    const layout = (lo: number, hi: number) => {
      let whites = 0
      for (let m = lo; m <= hi; m++) if (!isBlack(m)) whites++
      const ww = width / whites
      const bw = ww * 0.58
      let x = 0
      for (let m = lo; m <= hi; m++) {
        if (isBlack(m)) {
          xs[m] = x - bw / 2
          ws[m] = bw
        } else {
          xs[m] = x
          ws[m] = ww
          x += ww
        }
      }
      return ww
    }

    const hit = (x: number, y: number) => {
      const [lo, hi] = range
      if (y < top || y > height) return null
      if (y < top + blackHeight) for (let m = lo; m <= hi; m++) if (isBlack(m) && x >= xs[m] && x < xs[m] + ws[m]) return m
      for (let m = lo; m <= hi; m++) if (!isBlack(m) && x >= xs[m] && x < xs[m] + ws[m]) return m
      return null
    }

    const handColor = (midi: number, hand: number) => HANDS[hand][isBlack(midi) ? 1 : 0]

    const bar = (midi: number, color: string, y0: number, y1: number) => {
      const w = Math.max(1, ws[midi] - 3)
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(xs[midi] + 1.5, y0, w, Math.max(y1 - y0, 3), Math.min(5, w / 3))
      ctx.fill()
    }

    const drawSong = (pps: number, lookahead: number) => {
      const { time, marks } = player
      const { notes, longest } = player.song
      const seat = player.net?.seat ?? null
      for (let i = lowerBound(notes, time - longest); i < notes.length && notes[i].time < time + lookahead; i++) {
        const note = notes[i]
        const end = note.time + note.duration
        if (end <= time || note.midi < range[0] || note.midi > range[1]) continue
        const sounding = note.time <= time
        const color = handColor(note.midi, note.hand)
        if (sounding) lit[note.midi] = color
        const mine = seat === null || note.part === seat
        ctx.globalAlpha = (sounding || marks[i] === Mark.Hit ? 1 : 0.82) * (mine ? 1 : 0.4)
        bar(note.midi, color, top - (end - time) * pps, Math.min(top, top - (note.time - time) * pps))
      }
      ctx.globalAlpha = 1
    }

    const drawStrokes = (pps: number) => {
      const now = clock()
      player.sandbox.prune(now)
      const [lo, hi] = range
      for (const { midi, start, end, owner } of player.sandbox.strokes) {
        if (midi < lo || midi > hi) continue
        const color = owner === LOCAL ? handColor(midi, handFor(midi)) : (player.net?.peerColor(owner) ?? COLORS.user)
        bar(midi, color, top - (now - start) * pps, top - (now - Math.min(end, now)) * pps)
      }
    }

    const draw = () => {
      if (width <= 0 || height <= 0) return
      range = player.range
      const [lo, hi] = range
      const ww = layout(lo, hi)
      const share = touch.current ? 0.42 : 0.26
      const keysHeight = Math.min(Math.max(height * share, Math.min(height * 0.8, MIN_KEYS)), ww * (touch.current ? 7 : 5.2))
      top = height - keysHeight
      blackHeight = keysHeight * 0.62
      const lookahead = settings.lookahead
      const pps = top / lookahead
      const base = player.root
      const keymap = settings.keymap
      lit.fill(null)

      ctx.fillStyle = COLORS.bg
      ctx.fillRect(0, 0, width, height)

      if (keymap.codes.size) {
        const first = Math.max(lo, base + keymap.lo)
        const last = Math.min(hi, base + keymap.hi)
        ctx.fillStyle = COLORS.lane
        if (first <= last) ctx.fillRect(xs[first], 0, xs[last] + ws[last] - xs[first], top)
      }
      ctx.fillStyle = COLORS.octave
      for (let m = lo; m <= hi; m++) if (m % 12 === 0) ctx.fillRect(xs[m], 0, 1, top)

      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, width, top)
      ctx.clip()
      if (player.studio) drawStrokes(pps)
      else drawSong(pps, lookahead)
      ctx.restore()

      for (const [midi, color] of player.net?.remoteHeld() ?? []) lit[midi] ??= color
      for (const midi of player.sounding.keys()) lit[midi] ??= COLORS.user
      const editing = settings.editing && settings.editTarget !== null ? base + settings.editTarget : -1
      if (editing >= lo && editing <= hi) lit[editing] = COLORS.edit

      const glow = ctx.createLinearGradient(0, top - 48, 0, top)
      glow.addColorStop(0, 'transparent')
      glow.addColorStop(1, COLORS.octave)
      ctx.fillStyle = glow
      ctx.fillRect(0, top - 48, width, 48)

      for (let m = lo; m <= hi; m++) {
        if (isBlack(m)) continue
        ctx.fillStyle = lit[m] ?? COLORS.white
        ctx.beginPath()
        ctx.roundRect(xs[m] + 0.5, top, ww - 1, keysHeight - 1, [0, 0, 4, 4])
        ctx.fill()
      }
      for (let m = lo; m <= hi; m++) {
        if (!isBlack(m)) continue
        ctx.fillStyle = lit[m] ?? COLORS.black
        ctx.beginPath()
        ctx.roundRect(xs[m], top, ws[m], blackHeight, [0, 0, 3, 3])
        ctx.fill()
      }

      ctx.fillStyle = COLORS.seam
      ctx.fillRect(0, top, width, 4)
      ctx.fillStyle = COLORS.line
      ctx.fillRect(0, top - 1, width, 2)

      ctx.font = `600 ${Math.max(9, Math.min(13, ww * 0.3))}px ui-sans-serif, system-ui, sans-serif`
      ctx.textAlign = 'center'
      for (const [offset, code] of settings.labels || settings.editing ? keymap.codes : []) {
        const m = base + offset
        if (m < lo || m > hi) continue
        const black = isBlack(m)
        ctx.fillStyle = black ? COLORS.labelOnBlack : COLORS.labelOnWhite
        const label = keymap.shifted && black && code.startsWith(SHIFT) ? symbol(code.slice(SHIFT.length)) : symbol(code)
        ctx.fillText(label, xs[m] + ws[m] / 2, black ? top + blackHeight - 8 : height - 12)
      }
    }

    const pointers = new Map<number, number | null>()
    const fingers = new Uint8Array(128)
    /** Velocity from where the key is struck: near the front edge plays louder, like a real key's lever. */
    const velocityAt = (midi: number, y: number) => {
      const keyTop = top
      const keyBottom = isBlack(midi) ? top + blackHeight : height
      const depth = Math.max(0, Math.min(1, (y - keyTop) / Math.max(1, keyBottom - keyTop)))
      return MIN_VELOCITY + (MAX_VELOCITY - MIN_VELOCITY) * depth
    }
    const playPointer = (pointer: number, midi: number | null, y = 0) => {
      const previous = pointers.get(pointer) ?? null
      if (midi === previous) return
      pointers.set(pointer, midi)
      if (midi !== null && fingers[midi]++ === 0) player.press(midi, velocityAt(midi, y))
      if (previous !== null && --fingers[previous] === 0) player.release(previous)
    }
    const onPointerDown = (e: PointerEvent) => {
      const midi = hit(e.offsetX, e.offsetY)
      if (midi === null) return
      e.preventDefault()
      if (settings.editing) {
        settings.editTarget = midi - player.root
        return
      }
      playPointer(e.pointerId, midi, e.offsetY)
      canvas.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) playPointer(e.pointerId, hit(e.offsetX, e.offsetY), e.offsetY)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      playPointer(e.pointerId, null)
      pointers.delete(e.pointerId)
    }
    const releaseAll = () => {
      for (const id of [...pointers.keys()]) onPointerUp({ pointerId: id } as PointerEvent)
    }
    const noMenu = (e: Event) => e.preventDefault()
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('lostpointercapture', onPointerUp)
    canvas.addEventListener('contextmenu', noMenu)

    let raf = 0
    let last = performance.now()
    const frame = (now: number) => {
      player.tick(Math.min(0.1, (now - last) / 1000))
      last = now
      const animating = player.playing || (player.studio && player.sandbox.strokes.length > 0)
      if (animating || player.dirty) {
        draw()
        player.dirty = false
      }
      raf = requestAnimationFrame(frame)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      releaseAll()
    }
  })
</script>

<div class="relative h-full min-h-0 w-full"><canvas data-input-scope="performance" data-performance-surface tabindex="0" aria-label="Playable keyboard · Escape exits, Tab switches clip launch" bind:this={canvas}></canvas></div>

<style>
  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
</style>
