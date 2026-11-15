import { engine, type Voice } from './audio/engine.svelte'
import type { NoteSink } from './input/sink'
import { Sandbox } from './sandbox.svelte'
import { MediaQuery } from 'svelte/reactivity'
import { innerWidth } from 'svelte/reactivity/window'
import { centered as centeredOn, follow, HIGHEST_NOTE, LOWEST_NOTE, whiteAtOrAbove, whiteAtOrBelow, whitesFrom, whitesIn } from './keys-window'
import { layout } from './ui/layout.svelte'
import { RANGE_AUTO, RANGE_FULL, settings } from './settings.svelte'
import { demo, lowerBound, type Song } from './song'

export type Mode = 'wait' | 'listen'
export const MODES: Mode[] = ['wait', 'listen']

export const LEAD_IN = 2
const HIT_WINDOW = 0.25
const TAIL = 1
export const DEFAULT_VELOCITY = 0.8
const DRIFT = 0.15
const MIN_OCTAVE_WIDTH = 170
/** Narrowest white key a fingertip can hit; under a mouse keys may be as narrow as MIN_OCTAVE_WIDTH allows. */
const MIN_TOUCH_KEY = 40
/** Learn pans the keys to cover the notes due within this many seconds. */
const FOLLOW_AHEAD = 2

const coarse = new MediaQuery('pointer: coarse')

export const Mark = { Pending: 0, Hit: 1, Auto: 2 } as const

/** Transport controls that take over the keyboard shortcuts while Studio is open. */
export interface TransportKeys {
  toggle(): void
  record(): void
  /** Backspace: back to the start, or in step input, erase the previous step. */
  back(): void
  /** ←/→: a bar, or in step input, one step. */
  step(direction: 1 | -1): void
  /** Keys launch clips instead of playing notes. */
  readonly launchMode: boolean
  toggleLaunchMode(): void
  /** Handles a key in launch mode; false leaves it to the regular shortcuts. */
  launchKey(code: string): boolean
}

export type Transport = { mode: Mode; playing: boolean; time: number; speed: number; epoch: number; blocked: boolean }

/** What the player needs from a multiplayer session. Absent when playing alone. */
export interface NetLink {
  readonly isHost: boolean
  readonly seat: number | null
  occupied(part: number): boolean
  nameOf(owner: number): string
  peerColor(owner: number): string | undefined
  remoteHeld(): Iterable<readonly [number, string]>
  noteOn(midi: number, velocity: number): void
  noteOff(midi: number): void
  sustain(on: boolean): void
  hit(index: number): void
  shareTransport(): void
  shareSong(song: Song): void
}

export class Player implements NoteSink {
  song = $state.raw<Song>(demo)
  time = $state(-LEAD_IN)
  playing = $state(false)
  mode = $state<Mode>('wait')
  speed = $state(1)
  base = $state(48)
  hits = $state(0)
  misses = $state(0)
  sustain = $state(false)
  net = $state.raw<NetLink | null>(null)
  /** Studio is open: input plays freely and is captured instead of following the song. */
  studio = $state(false)
  studioKeys = $state.raw<TransportKeys | undefined>()

  root = $derived(this.base + settings.transpose)
  canControl = $derived(!this.net || this.net.isHost)
  playable = $derived(!this.net || this.net.seat !== null)

  /** Lowest key of the keyboard while Learn follows a song wider than the screen. */
  pan = $state<number | null>(null)

  /** Two stacked rows of keys: Play on a phone held upright, when chosen in settings. */
  rows = $derived<1 | 2>(this.studio && !this.studioKeys && coarse.current && layout.kind === 'upright' && settings.keyRows === 2 ? 2 : 1)

  /** How many white keys fit across, and the song's lowest and highest note (or the keys' when there is no song). */
  #span = $derived.by(() => {
    const width = innerWidth.current ?? Infinity
    const whites = Math.max(7, Math.floor(width / (coarse.current ? MIN_TOUCH_KEY : MIN_OCTAVE_WIDTH / 7)))
    let lo = Infinity
    let hi = -Infinity
    if (!this.studio) for (const { midi } of this.song.notes) ((lo = Math.min(lo, midi)), (hi = Math.max(hi, midi)))
    return { whites, lo, hi, wide: lo <= hi && whitesIn(whiteAtOrBelow(lo), whiteAtOrAbove(hi)) > whites }
  })

  range = $derived.by((): readonly [number, number] => {
    const { lo: low, hi: high } = settings.keymap
    const keysLo = this.root + low
    const keysHi = this.root + high
    if (settings.range === RANGE_FULL) return [LOWEST_NOTE, HIGHEST_NOTE]
    const centered = (octaves: number): readonly [number, number] => {
      const span = 12 * octaves
      const lo = Math.round(((keysLo + keysHi) / 2 - span / 2) / 12) * 12
      const start = Math.max(0, Math.min(lo, 128 - span))
      return [start, Math.min(127, start + span)]
    }
    if (settings.range !== RANGE_AUTO) return centered(Number(settings.range))
    const { whites, wide } = this.#span
    // A song wider than the screen: a window of keys that follows the notes (see #follow).
    if (wide) return whitesFrom(this.pan ?? whiteAtOrBelow(this.#span.lo), whites)
    // Touch, no song to fit: keys from the octave you picked, as many as fit at fingertip size (twice over in two rows).
    if (coarse.current && (this.studio || this.#span.lo > this.#span.hi)) return whitesFrom(this.root - (((this.root % 12) + 12) % 12), whites * this.rows)
    // The song fits: centre it, keeping every key fingertip-sized.
    if (coarse.current) return centeredOn(this.#span.lo, this.#span.hi, whites)
    let lo = keysLo
    let hi = keysHi
    if (!this.studio) ((lo = Math.min(lo, this.#span.lo)), (hi = Math.max(hi, this.#span.hi)))
    lo = Math.max(0, lo - (lo % 12))
    hi = Math.min(127, hi + 11 - (hi % 12))
    const fits = Math.max(2, Math.floor((innerWidth.current ?? Infinity) / MIN_OCTAVE_WIDTH))
    return (hi - lo + 1) / 12 > fits ? centered(fits) : [lo, hi]
  })

  /** The song needs more keys than fit across the screen. */
  get wide() {
    return this.#span.wide
  }

  /** Learn with a song wider than the screen: move the keys only when the coming notes leave them. */
  #follow() {
    if (this.studio || settings.range !== RANGE_AUTO || !this.#span.wide) return
    const { notes } = this.song
    let min = Infinity
    let max = -Infinity
    for (let i = lowerBound(notes, this.time); i < notes.length && notes[i].time < this.time + FOLLOW_AHEAD; i++) {
      min = Math.min(min, notes[i].midi)
      max = Math.max(max, notes[i].midi)
    }
    if (min > max) return
    const start = follow(this.range, min, max, this.#span.lo, this.#span.hi, this.#span.whites)
    if (start !== this.range[0]) this.pan = start
  }

  readonly sandbox = new Sandbox()
  readonly held = new Set<number>()
  /** Notes sounding from the player's own keys, after the live-input map; drawn on the keyboard. */
  readonly sounding = new Map<number, number>()
  /** Studio's input processing: which notes a key plays and how loud. */
  liveInput?: { map(midi: number): number[]; readonly velocity: number }
  marks = new Uint8Array(demo.notes.length)
  blocked = false
  dirty = true

  #cursor = 0
  #epoch = 0
  #autoVoices = new Map<number, Voice>()
  #notes = new Map<number, number[]>()

  get finished() {
    return this.time >= this.song.duration + TAIL
  }

  get transport(): Transport {
    return { mode: this.mode, playing: this.playing, time: this.time, speed: this.speed, epoch: this.#epoch, blocked: this.blocked }
  }

  reachable(midi: number) {
    return settings.keymap.codes.has(midi - this.root)
  }

  setMode(mode: Mode) {
    if (mode === this.mode || !this.canControl) return
    if (this.playing) this.#setPlaying(false)
    this.mode = mode
    this.#epoch++
    this.net?.shareTransport()
  }

  setSpeed(speed: number) {
    if (!this.canControl) return
    this.speed = speed
    this.net?.shareTransport()
  }

  load(song: Song) {
    if (!this.canControl) return
    this.#load(song)
    this.net?.shareSong(song)
    this.net?.shareTransport()
  }

  restart() {
    if (!this.canControl) return
    this.#epoch++
    this.#reset(-LEAD_IN)
    this.net?.shareTransport()
  }

  seek(time: number) {
    if (!this.canControl) return
    this.#epoch++
    this.#reset(time)
    this.net?.shareTransport()
  }

  toggle() {
    if (!this.canControl) return
    if (!this.playing && this.finished) {
      this.#epoch++
      this.#reset(-LEAD_IN)
    }
    this.#setPlaying(!this.playing)
    this.net?.shareTransport()
  }

  fit() {
    const { codes, lo, hi } = settings.keymap
    const seat = this.net?.seat
    const notes = seat != null ? this.song.notes.filter((n) => n.part === seat) : this.song.notes
    if (!codes.size || !notes.length) return
    let best = this.base
    let bestScore = -1
    for (let base = 0; base <= 120; base += 12) {
      const root = base + settings.transpose
      if (root + lo < LOWEST_NOTE - 12 || root + hi > HIGHEST_NOTE + 12) continue
      let score = 0
      for (const { midi } of notes) if (codes.has(midi - root)) score++
      const closer = Math.abs(base - this.base) < Math.abs(best - this.base)
      if (score > bestScore || (score === bestScore && closer)) {
        best = base
        bestScore = score
      }
    }
    this.base = best
  }

  shift(semitones: number) {
    const root = this.root + semitones
    const { lo, hi } = settings.keymap
    if (root + lo < LOWEST_NOTE - 12 || root + hi > HIGHEST_NOTE + 12) return
    this.base += semitones
  }

  /** A played key; in Studio it may sound several notes (transpose, scale lock, chords). `held` keeps played keys. */
  press(midi: number, velocity = this.liveInput?.velocity ?? DEFAULT_VELOCITY, sounded = false) {
    if (this.held.has(midi)) return
    this.held.add(midi)
    const notes = this.liveInput?.map(midi) ?? [midi]
    this.#notes.set(midi, notes)
    for (const note of notes) {
      this.#sound(note, 1)
      engine.keyOn(engine.liveChannel, note, velocity, sounded)
      if (this.playable) this.net?.noteOn(note, velocity)
      if (this.studio) this.sandbox.noteOn(note, velocity)
      else if (this.playing && this.mode === 'wait' && this.playable) this.#score(note)
    }
    this.dirty = true
  }

  release(midi: number, sounded = false) {
    if (!this.held.delete(midi)) return
    const notes = this.#notes.get(midi) ?? [midi]
    this.#notes.delete(midi)
    for (const note of notes) {
      // Another held key may share this note (overlapping chords): the engine counts holds, the rest waits for the last.
      const still = this.#sound(note, -1) > 0
      engine.keyOff(engine.liveChannel, note, sounded, still)
      if (!still) this.sandbox.noteOff(note)
      if (this.playable) this.net?.noteOff(note)
    }
    this.dirty = true
  }

  /** Counts keys sounding each note, so overlapping chords light and stop correctly. */
  #sound(note: number, change: 1 | -1) {
    const count = Math.max(0, (this.sounding.get(note) ?? 0) + change)
    if (count > 0) this.sounding.set(note, count)
    else this.sounding.delete(note)
    return count
  }

  setSustain(on: boolean, sounded = false) {
    if (this.sustain === on) return
    this.sustain = on
    engine.pedal(engine.liveChannel, on, sounded)
    if (this.studio) this.sandbox.pedal(on)
    if (this.playable) this.net?.sustain(on)
  }

  applySong(song: Song) {
    this.#load(song)
  }

  applyTransport(transport: Transport, elapsed: number) {
    const expected = transport.time + (transport.playing && !transport.blocked ? elapsed * transport.speed : 0)
    this.speed = transport.speed
    if (transport.epoch !== this.#epoch || transport.mode !== this.mode) {
        this.#epoch = transport.epoch
      this.mode = transport.mode
      this.#reset(expected)
    } else if (Math.abs(this.time - expected) > DRIFT) {
      this.#jump(expected)
    }
    if (transport.playing !== this.playing) this.#setPlaying(transport.playing)
  }

  applyHit(index: number) {
    if (this.marks[index] !== Mark.Pending) return
    this.marks[index] = Mark.Hit
    this.dirty = true
  }

  tick(dt: number) {
    if (!this.playing) return
    const { notes } = this.song
    let time = this.time + dt * this.speed
    const heard = time + settings.audioLead * this.speed
    this.blocked = false

    for (const [i, voice] of this.#autoVoices) {
      if (notes[i].time + notes[i].duration > heard) continue
      voice.stop()
      this.#autoVoices.delete(i)
    }

    for (; this.#cursor < notes.length && notes[this.#cursor].time <= heard; this.#cursor++) {
      const i = this.#cursor
      const note = notes[i]
      if (this.marks[i] !== Mark.Pending) continue
      if (this.#blocks(i)) {
        if (note.time > time) break
        time = note.time
        this.blocked = true
        break
      }
      this.marks[i] = Mark.Auto
      this.#autoVoices.set(i, engine.noteOn(note.midi, note.velocity))
    }

    this.time = time
    this.#follow()
    if (this.finished && this.canControl) this.toggle()
  }

  #blocks(index: number) {
    if (this.mode !== 'wait') return false
    const note = this.song.notes[index]
    if (!this.net) return this.reachable(note.midi)
    if (!this.net.occupied(note.part)) return false
    if (note.part === this.net.seat && !this.reachable(note.midi)) {
      this.net.hit(index)
      return false
    }
    return true
  }

  #load(song: Song) {
    this.song = song
    this.#epoch++
    this.#setPlaying(false)
    this.fit()
    this.#reset(-LEAD_IN)
  }

  #reset(time: number) {
    this.#silence()
    this.time = Math.max(-LEAD_IN, Math.min(time, this.song.duration))
    this.#cursor = lowerBound(this.song.notes, this.time)
    this.marks = new Uint8Array(this.song.notes.length)
    this.hits = 0
    this.misses = 0
    this.pan = null
    this.#follow()
    this.dirty = true
  }

  #jump(time: number) {
    this.time = Math.max(-LEAD_IN, Math.min(time, this.song.duration + TAIL))
    this.#cursor = lowerBound(this.song.notes, this.time)
    this.#follow()
    this.dirty = true
  }

  #setPlaying(playing: boolean) {
    this.playing = playing
    if (!playing) this.#silence()
  }

  #score(midi: number) {
    const { notes } = this.song
    const seat = this.net?.seat
    for (let i = this.#cursor; i < notes.length && notes[i].time <= this.time + HIT_WINDOW; i++) {
      const note = notes[i]
      if (this.marks[i] !== Mark.Pending || note.midi !== midi || (seat != null && note.part !== seat)) continue
      this.marks[i] = Mark.Hit
      this.hits++
      this.net?.hit(i)
      return
    }
    this.misses++
  }

  #silence() {
    for (const voice of this.#autoVoices.values()) voice.stop()
    this.#autoVoices.clear()
  }
}
