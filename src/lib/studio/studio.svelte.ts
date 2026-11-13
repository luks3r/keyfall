import { ensureClick } from '../audio/click'
import { engine, FIRST_TRACK_CHANNEL, LOCAL_CHANNEL, TRACK_CHANNELS } from '../audio/engine.svelte'
import { loadSample } from '../audio/samples'
import { encodePreset, sound } from '../audio/sound.svelte'
import { platform } from '../platform'
import type { Player, TransportKeys } from '../player.svelte'
import { clock, LOCAL, type Capture } from '../sandbox.svelte'
import { settings } from '../settings.svelte'
import type { Song } from '../song'
import { controls, type Target } from './controls.svelte'
import { live } from './live.svelte'
import { encodePattern, encodeTimeline, STATUS, STOP_PENDING } from './engine'
import {
  allClips,
  clipEnd,
  createClip,
  createProject,
  createScene,
  createTrack,
  fromSong,
  KIT,
  migrate,
  toSong,
  type Clip,
  type Pad,
  type Project,
  type Track,
} from './project'

const STORAGE_KEY = 'keyfall.project.v1'
const PREFS_KEY = 'keyfall.studio.v1'
const SAVE_DELAY_MS = 400
const HISTORY = 100
/** Notes played this early before a recording's first beat still count, landing on it. */
const ANTICIPATION = 0.25
const MIN_NOTE = 1 / 64
const MIN_LOOP = 1
/** Computer-keyboard launch grid: four rows of keys over four scenes, eight columns over eight tracks. */
const LAUNCH_ROWS = [
  ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma'],
]
export const LAUNCH_KEYS = new Map(LAUNCH_ROWS.flatMap((row, scene) => row.map((code, track) => [code, { scene, track }] as const)))

export type View = 'session' | 'arrange'
export type Slot = { track: string; scene: number }
type LaneState = { active: string | null; queued: string | null; origin: number }
type Held = { pitch: number; at: number; velocity: number }
/** Step input: played notes land at `cursor` (in steps of `resolution` beats) and the cursor moves on. */
export type StepInput = { clip: string; cursor: number; resolution: number }
type Recording = { kind: 'arrange' } | { kind: 'session'; track: string; clip: string }

function load(): Project {
  try {
    const stored = migrate(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? {})
    if (stored) return stored
  } catch {}
  return createProject()
}

function loadPrefs(): { view: View; metronome: boolean; countIn: boolean } {
  const defaults = { view: 'session' as View, metronome: true, countIn: true }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

export const trackChannel = (index: number) => FIRST_TRACK_CHANNEL + (index % TRACK_CHANNELS)
export const MAX_TRACKS = TRACK_CHANNELS
export const STOP = 'stop'
export const isKit = (track: Track) => track.preset === KIT

const prefs = loadPrefs()

/**
 * The producing workspace. The audio engine owns timing (clip launches, loops, metronome); this class keeps it
 * fed with the project, mirrors its status for the UI and records what the player plays.
 */
export class Studio implements TransportKeys, Capture {
  project = $state<Project>(load())
  view = $state<View>(prefs.view)
  selectedTrack = $state<string | null>(null)
  selectedClip = $state<string | null>(null)
  selectedScene = $state(0)
  playing = $state(false)
  recording = $state<Recording | null>(null)
  /** Song position (beats) as heard, refreshed once per frame. */
  position = $state(0)
  /** Forward-only beat clock that session clips and launch quantization follow. */
  beat = $state(0)
  lanes = $state<LaneState[]>([])
  metronome = $state(prefs.metronome)
  countIn = $state(prefs.countIn)
  launchMode = $state(false)
  stepInput = $state<StepInput | null>(null)
  history = $state({ undo: 0, redo: 0 })
  #prerolling = $state(false)
  #attached = $state(false)

  track = $derived(this.project.tracks.find((t) => t.id === this.selectedTrack) ?? this.project.tracks[0] ?? null)
  trackIndex = $derived(this.track ? this.project.tracks.indexOf(this.track) : -1)
  clip = $derived(this.#findClip(this.selectedClip)?.clip ?? null)
  soloing = $derived(this.project.tracks.some((t) => t.solo))

  #player?: Player
  #undo: string[] = []
  #redo: string[] = []
  #frame = 0
  #ids = new Map<string, number>()
  #clips = new Map<number, string>()
  #nextId = 1
  #patterns = new Map<string, string>()
  #timelines: string[] = []
  #instruments = new Map<number, string>()
  #kits = new Map<number, string>()
  #anchor = { at: 0, beat: 0, song: 0 }
  #recordFrom = 0
  #looping = false
  #held = new Map<string, Held>()
  #sustained = new Map<string, Held & { end: number }>()
  #pedals = new Set<number>()
  #peerTracks = new Map<number, string>()
  #stepHeld = new Set<string>()
  #liveInput = {
    map: (midi: number) => (this.track && isKit(this.track) ? [midi] : live.map(midi)),
    get velocity() {
      return live.settings.velocity
    },
  }

  constructor() {
    $effect.root(() => {
      let timer = 0
      $effect(() => {
        const json = JSON.stringify(this.project)
        clearTimeout(timer)
        timer = window.setTimeout(() => {
          try {
            localStorage.setItem(STORAGE_KEY, json)
          } catch {}
        }, SAVE_DELAY_MS)
      })
      $effect(() => {
        try {
          localStorage.setItem(PREFS_KEY, JSON.stringify({ view: this.view, metronome: this.metronome, countIn: this.countIn }))
        } catch {}
      })
      $effect(() => this.#syncPatterns())
      $effect(() => this.#syncTimelines())
      $effect(() => {
        const { tempo, quantize, beatsPerBar, loop } = this.project
        platform.audio.sequencer.configure({
          tempo,
          quantum: quantize,
          beatsPerBar,
          metronome: this.metronome || (this.#prerolling && this.countIn),
          loop: loop.enabled ? [loop.start, Math.max(loop.start + MIN_LOOP, loop.end)] : null,
        })
      })
      $effect(() => this.#syncInstruments())
      $effect(() => {
        const soloing = this.soloing
        this.project.tracks.forEach((track, i) => engine.setChannelGain(trackChannel(i), this.#audible(track, soloing) ? track.volume : 0))
      })
      $effect(() => {
        const index = this.trackIndex
        if (this.#player) engine.setLiveChannel(index >= 0 ? trackChannel(index) : LOCAL_CHANNEL)
      })
      $effect(() => {
        const mapped = !!this.#attached && !(this.track && isKit(this.track)) && !live.identity
        platform.audio.setNoteMap(mapped ? live.table : [])
      })
    })
    controls.run = (target, value) => this.#runControl(target, value)
  }

  /** Takes over live input while Studio is open. */
  attach(player: Player) {
    this.#player = player
    player.studio = true
    player.studioKeys = this
    player.sandbox.capture = this
    player.liveInput = this.#liveInput
    player.dirty = true
    this.#attached = true
    ensureClick()
    engine.setLiveChannel(this.trackIndex >= 0 ? trackChannel(this.trackIndex) : LOCAL_CHANNEL)
    const frame = () => {
      this.#readStatus()
      this.#frame = requestAnimationFrame(frame)
    }
    this.#frame = requestAnimationFrame(frame)
  }

  detach() {
    this.stop()
    cancelAnimationFrame(this.#frame)
    const player = this.#player
    this.#player = undefined
    this.launchMode = false
    this.stepInput = null
    this.#attached = false
    engine.setLiveChannel(LOCAL_CHANNEL)
    if (!player) return
    player.liveInput = undefined
    player.studio = false
    player.studioKeys = undefined
    player.sandbox.capture = undefined
    player.dirty = true
  }

  // Engine sync

  #engineId(clip: Clip) {
    let id = this.#ids.get(clip.id)
    if (id === undefined) {
      id = this.#nextId++
      this.#ids.set(clip.id, id)
      this.#clips.set(id, clip.id)
    }
    return id
  }

  /** Sends clips whose content changed; also called right before launches so new clips exist in the engine. */
  #syncPatterns() {
    for (const clip of allClips(this.project)) {
      const key = JSON.stringify([clip.length, clip.repeat, clip.quantize, clip.notes])
      if (this.#patterns.get(clip.id) === key) continue
      this.#patterns.set(clip.id, key)
      platform.audio.sequencer.pattern(this.#engineId(clip), encodePattern(clip))
    }
  }

  #syncTimelines() {
    this.#syncPatterns()
    const lanes = Math.max(this.project.tracks.length, this.#timelines.length)
    for (let lane = 0; lane < lanes; lane++) {
      const track = this.project.tracks[lane]
      const data = track ? encodeTimeline(track, (clip) => this.#engineId(clip)) : new Float32Array()
      const key = data.join(',')
      if (this.#timelines[lane] === key) continue
      this.#timelines[lane] = key
      platform.audio.sequencer.timeline(lane, data)
    }
    this.#timelines.length = this.project.tracks.length
  }

  #syncInstruments() {
    this.project.tracks.forEach((track, i) => {
      const channel = trackChannel(i)
      if (isKit(track)) {
        const key = `${track.id}:${JSON.stringify(track.pads)}`
        if (this.#kits.get(channel) === key) return
        this.#kits.set(channel, key)
        this.#instruments.delete(channel)
        void this.#loadKit(channel, $state.snapshot(track.pads))
        return
      }
      const key = `${track.id}:${track.preset}`
      if (this.#instruments.get(channel) === key) return
      this.#instruments.set(channel, key)
      this.#kits.delete(channel)
      void engine.setSound(channel, encodePreset(sound.find(track.preset)))
    })
  }

  async #loadKit(channel: number, pads: Pad[]) {
    platform.audio.clearKit(channel)
    const samples = await Promise.all(pads.map((pad) => (pad.sample ? loadSample(pad.sample) : null)))
    pads.forEach((pad, i) => platform.audio.setPad(channel, pad.midi, samples[i]))
  }

  #readStatus() {
    const status = platform.audio.sequencer.status()
    if (!status) return
    const now = clock()
    const playing = status[STATUS.playing] === 1
    const beat = status[STATUS.clock]
    const song = status[STATUS.song]
    this.#anchor = { at: now, beat, song }
    if (playing !== this.playing) {
      this.playing = playing
      if (!playing && this.recording) this.#finishRecording()
    }
    if (playing) {
      const lead = (settings.audioLead * this.project.tempo) / 60
      this.position = Math.max(0, song - lead)
      this.beat = beat
      if (this.#prerolling && song >= this.#recordFrom) this.#prerolling = false
    }
    const lanes = this.project.tracks.map((_, lane): LaneState => {
      const at = STATUS.header + lane * STATUS.perLane
      const queued = status[at + 2]
      return {
        active: this.#clips.get(status[at]) ?? null,
        origin: status[at + 1],
        queued: queued === STOP_PENDING ? STOP : (this.#clips.get(queued) ?? null),
      }
    })
    if (JSON.stringify(lanes) !== JSON.stringify(this.lanes)) this.lanes = lanes
  }

  // History

  /** Records the current state as one undo step; call before every edit, or once before a drag. */
  commit() {
    this.#undo.push(JSON.stringify(this.project))
    if (this.#undo.length > HISTORY) this.#undo.shift()
    this.#redo = []
    this.#counts()
  }

  edit(change: (project: Project) => void) {
    this.commit()
    change(this.project)
  }

  undo() {
    this.#swap(this.#undo, this.#redo)
  }

  redo() {
    this.#swap(this.#redo, this.#undo)
  }

  #swap(from: string[], to: string[]) {
    const previous = from.pop()
    if (!previous) return
    to.push(JSON.stringify(this.project))
    this.project = JSON.parse(previous)
    this.#counts()
  }

  #counts() {
    this.history = { undo: this.#undo.length, redo: this.#redo.length }
  }

  // Project

  load(project: Project) {
    this.stop()
    this.commit()
    this.project = project
    this.position = 0
    this.selectedTrack = project.tracks[0]?.id ?? null
    this.selectedClip = null
  }

  openSong(song: Song) {
    this.load(fromSong(song))
    this.view = 'arrange'
  }

  /** The tracks' timelines as a song to practise in Learn; all tracks when none are given. */
  practice(trackIds?: string[]): Song {
    return toSong($state.snapshot(this.project), trackIds && new Set(trackIds))
  }

  addTrack(preset = this.track && !isKit(this.track) ? this.track.preset : undefined, pads: Pad[] = []) {
    if (this.project.tracks.length >= MAX_TRACKS) return null
    const name = preset === KIT ? 'Drums' : `Track ${this.project.tracks.length + 1}`
    const track = createTrack(name, preset, this.project.scenes.length, pads)
    this.edit((p) => p.tracks.push(track))
    this.selectedTrack = track.id
    return track
  }

  removeTrack(id: string) {
    this.edit((p) => (p.tracks = p.tracks.filter((t) => t.id !== id)))
    if (this.selectedTrack === id) this.selectedTrack = this.project.tracks[0]?.id ?? null
  }

  addScene() {
    this.edit((p) => {
      p.scenes.push(createScene(p.scenes.length))
      for (const track of p.tracks) track.slots.push(null)
    })
  }

  addClip(track: Track, start: number, length = this.project.beatsPerBar) {
    const clip = createClip(start, length)
    this.edit(() => track.clips.push(clip))
    this.select(track.id, clip.id)
    return clip
  }

  /** Creates an empty looping clip in a session slot. */
  addSlotClip(track: Track, scene: number, length = this.project.loopBars * this.project.beatsPerBar) {
    const clip = createClip(0, length)
    this.edit(() => (track.slots[scene] = clip))
    this.selectSlot(track.id, scene)
    return track.slots[scene]!
  }

  removeClip(track: Track, id: string) {
    this.edit(() => {
      track.clips = track.clips.filter((c) => c.id !== id)
      track.slots = track.slots.map((c) => (c?.id === id ? null : c))
    })
    if (this.selectedClip === id) this.selectedClip = null
  }

  duplicateClip(track: Track, clip: Clip) {
    const copy = { ...structuredClone($state.snapshot(clip)), id: createClip(0, 0).id }
    const scene = track.slots.findIndex((c) => c?.id === clip.id)
    if (scene >= 0) {
      const free = track.slots.findIndex((c, i) => i > scene && !c)
      if (free < 0) return
      this.edit(() => (track.slots[free] = copy))
      return this.selectSlot(track.id, free)
    }
    copy.start = clipEnd(clip)
    this.edit(() => track.clips.push(copy))
    this.select(track.id, copy.id)
  }

  select(trackId: string | null, clipId: string | null = null) {
    this.selectedTrack = trackId
    this.selectedClip = clipId
  }

  selectSlot(trackId: string, scene: number) {
    const track = this.project.tracks.find((t) => t.id === trackId)
    this.selectedTrack = trackId
    this.selectedScene = scene
    this.selectedClip = track?.slots[scene]?.id ?? null
  }

  #findClip(id: string | null) {
    if (!id) return null
    for (const track of this.project.tracks) {
      const clip = track.clips.find((c) => c.id === id) ?? track.slots.find((c) => c?.id === id)
      if (clip) return { track, clip }
    }
    return null
  }

  setTempo(tempo: number) {
    this.project.tempo = Math.max(20, Math.min(300, Math.round(tempo)))
  }

  toggleLoop() {
    const { loop } = this.project
    loop.enabled = !loop.enabled
    if (loop.end - loop.start < MIN_LOOP) loop.end = loop.start + this.project.beatsPerBar
  }

  // Transport

  toggle() {
    if (this.playing) this.stop()
    else this.play()
  }

  play(preroll = 0) {
    this.#syncTimelines()
    platform.audio.sequencer.play(this.position - preroll)
    this.playing = true
    this.#looping = this.project.loop.enabled && this.position < this.project.loop.end
  }

  stop() {
    if (this.recording) this.#finishRecording()
    this.#prerolling = false
    platform.audio.sequencer.stop()
    this.playing = false
  }

  /** Launches a session clip on the next quantum (or stops the track with `null`). */
  launch(track: Track, clip: Clip | null, quantized = true) {
    const lane = this.project.tracks.indexOf(track)
    if (lane < 0) return
    this.#syncPatterns()
    platform.audio.sequencer.launch(lane, clip ? this.#engineId(clip) : 0, quantized)
    if (clip && !this.playing) this.playing = true
  }

  launchScene(scene: number) {
    this.#syncPatterns()
    this.selectedScene = scene
    this.project.tracks.forEach((track, lane) => {
      const clip = track.slots[scene]
      platform.audio.sequencer.launch(lane, clip ? this.#engineId(clip) : 0, true)
    })
  }

  stopAll() {
    this.project.tracks.forEach((_, lane) => platform.audio.sequencer.launch(lane, 0, true))
  }

  /** Starts recording: into the selected slot in Session (creating a loop clip), or onto the timeline in Arrange. */
  record() {
    if (this.recording) return this.#finishRecording()
    if (!this.track) this.addTrack()
    const track = this.track!
    this.#held.clear()
    this.#sustained.clear()
    if (this.view === 'session') {
      const scene = this.selectedScene
      const clip = track.slots[scene] ?? this.addSlotClip(track, scene)
      this.commit()
      this.recording = { kind: 'session', track: track.id, clip: clip.id }
      this.selectedClip = clip.id
      if (this.#lane(track)?.active !== clip.id) this.launch(track, clip)
      return
    }
    this.commit()
    this.recording = { kind: 'arrange' }
    if (this.playing) {
      this.#recordFrom = this.#songAt(clock())
    } else {
      this.#recordFrom = this.position
      this.#prerolling = this.countIn
      this.play(this.countIn ? this.project.beatsPerBar : 0)
    }
  }

  restart() {
    const wasPlaying = this.playing
    this.stop()
    this.seek(this.project.loop.enabled ? this.project.loop.start : 0)
    if (wasPlaying) this.play()
  }

  step(direction: 1 | -1) {
    const bar = this.project.beatsPerBar
    this.seek(Math.max(0, (Math.round(this.position / bar) + direction) * bar))
  }

  seek(beat: number) {
    const wasPlaying = this.playing && !this.recording
    if (wasPlaying) this.stop()
    this.position = Math.max(0, beat)
    if (wasPlaying) this.play()
  }

  #lane(track: Track) {
    return this.lanes[this.project.tracks.indexOf(track)]
  }

  laneOf(track: Track): LaneState | undefined {
    return this.#lane(track)
  }

  #audible(track: Track, soloing = this.soloing) {
    return !track.muted && (!soloing || track.solo)
  }

  // Launch keys and controllers

  toggleLaunchMode() {
    this.launchMode = !this.launchMode
  }

  launchKey(code: string): boolean {
    const cell = LAUNCH_KEYS.get(code)
    if (cell) {
      const track = this.project.tracks[cell.track]
      const scene = cell.scene
      if (track && scene < this.project.scenes.length) this.launch(track, track.slots[scene])
      return true
    }
    switch (code) {
      case 'Enter':
        this.launchScene(this.selectedScene)
        return true
      case 'ArrowUp':
      case 'ArrowDown':
        this.selectedScene = Math.max(0, Math.min(this.project.scenes.length - 1, this.selectedScene + (code === 'ArrowUp' ? -1 : 1)))
        return true
      case 'Escape':
        this.stopAll()
        return true
    }
    return false
  }

  #runControl(target: Target, value: number) {
    const track = 'track' in target ? this.project.tracks[target.track] : undefined
    switch (target.kind) {
      case 'slot':
        if (track) this.launch(track, track.slots[target.scene] ?? null)
        return
      case 'scene':
        return this.launchScene(target.scene)
      case 'stop':
        if (track) this.launch(track, null)
        return
      case 'stop-all':
        return this.stopAll()
      case 'play':
        return this.toggle()
      case 'volume':
        if (track) track.volume = value
    }
  }

  // Recording

  #key = (midi: number, owner: number) => `${owner}:${midi}`

  /** Clock beat a player meant: they hear audio `audioLead` late, so their input arrives that much late. */
  #beatAt(at: number) {
    return this.#anchor.beat + ((at - settings.audioLead - this.#anchor.at) * this.project.tempo) / 60
  }

  #songAt(at: number) {
    return this.#anchor.song + ((at - settings.audioLead - this.#anchor.at) * this.project.tempo) / 60
  }

  noteOn(midi: number, velocity: number, owner: number, at: number) {
    if (this.stepInput && !this.recording && owner === LOCAL) return this.#stepNote(midi, velocity)
    if (!this.recording) return
    const beat = this.recording.kind === 'session' ? this.#beatAt(at) : this.#songAt(at)
    if (this.recording.kind === 'arrange' && beat < this.#recordFrom - ANTICIPATION) return
    this.#held.set(this.#key(midi, owner), { pitch: midi, at: beat, velocity })
  }

  noteOff(midi: number, owner: number, at: number) {
    if (this.stepInput && owner === LOCAL && this.#stepHeld.delete(String(midi)) && !this.#stepHeld.size) this.stepMove(1)
    const key = this.#key(midi, owner)
    const held = this.#held.get(key)
    if (!held || !this.recording) return
    this.#held.delete(key)
    const end = this.recording.kind === 'session' ? this.#beatAt(at) : this.#songAt(at)
    if (this.#pedals.has(owner)) this.#sustained.set(key, { ...held, end })
    else this.#write(owner, held, end)
  }

  pedal(down: boolean, owner: number, at: number) {
    if (down) return void this.#pedals.add(owner)
    this.#pedals.delete(owner)
    if (!this.recording) return
    const end = this.recording.kind === 'session' ? this.#beatAt(at) : this.#songAt(at)
    for (const [key, note] of this.#sustained) {
      if (!key.startsWith(`${owner}:`)) continue
      this.#sustained.delete(key)
      this.#write(owner, note, Math.max(note.end, end))
    }
  }

  /** Notes held together share a step; the cursor moves on when the last one is released. */
  #stepNote(midi: number, velocity: number) {
    const input = this.stepInput!
    const found = this.#findClip(input.clip)
    if (!found) return
    if (!this.#stepHeld.size) this.commit()
    this.#stepHeld.add(String(midi))
    const start = input.cursor * input.resolution
    const clip = found.clip
    clip.notes = clip.notes.filter((n) => !(n.pitch === midi && Math.abs(n.start - start) < 1e-6))
    clip.notes.push({ pitch: midi, start, length: input.resolution, velocity })
  }

  /** Moves the step-input cursor, wrapping at the clip end. */
  stepMove(steps: number) {
    const input = this.stepInput
    const clip = input && this.#findClip(input.clip)?.clip
    if (!input || !clip) return
    const count = Math.max(1, Math.round(clip.length / input.resolution))
    input.cursor = (((input.cursor + steps) % count) + count) % count
  }

  #finishRecording() {
    const recording = this.recording
    if (!recording) return
    const now = recording.kind === 'session' ? this.#beatAt(clock()) : this.#songAt(clock())
    for (const [key, note] of [...this.#held, ...this.#sustained]) this.#write(Number(key.split(':')[0]), note, now)
    this.#held.clear()
    this.#sustained.clear()
    this.recording = null
    this.#prerolling = false
  }

  #write(owner: number, note: Held, end: number) {
    const recording = this.recording
    if (!recording) return
    if (recording.kind === 'session') {
      if (owner === LOCAL) this.#writeSlot(recording, note, end)
      return
    }
    const track = this.#targetTrack(owner)
    if (track) this.#writeTimeline(track, note, end)
  }

  /** Overdubs into a looping slot clip: positions wrap at the clip length. */
  #writeSlot(recording: Extract<Recording, { kind: 'session' }>, note: Held, end: number) {
    const found = this.#findClip(recording.clip)
    if (!found) return
    const lane = this.#lane(found.track)
    const clip = found.clip
    const origin = lane?.active === clip.id ? lane.origin : null
    if (origin === null) return
    const local = note.at - origin
    if (local < -ANTICIPATION) return
    const start = ((Math.max(0, local) % clip.length) + clip.length) % clip.length
    const length = Math.min(clip.length - start, Math.max(MIN_NOTE, end - note.at))
    clip.notes.push({ pitch: note.pitch, start, length, velocity: note.velocity })
  }

  #targetTrack(owner: number): Track | null {
    if (owner === LOCAL) return this.track
    const known = this.project.tracks.find((t) => t.id === this.#peerTracks.get(owner))
    if (known) return known
    if (this.project.tracks.length >= MAX_TRACKS) return null
    const track = createTrack(this.#player?.net?.nameOf(owner) ?? `Player ${owner}`, undefined, this.project.scenes.length)
    this.project.tracks.push(track)
    this.#peerTracks.set(owner, track.id)
    return this.project.tracks.at(-1)!
  }

  #map(beat: number) {
    const { start, end } = this.project.loop
    if (!this.#looping || beat < end) return beat
    return start + ((beat - end) % Math.max(MIN_LOOP, end - start))
  }

  #writeTimeline(track: Track, note: Held, endBeat: number) {
    const { loop, beatsPerBar } = this.project
    const at = Math.max(note.at, this.#recordFrom)
    const start = this.#map(at)
    const wrapped = this.#looping && endBeat >= at - start + loop.end
    const end = wrapped ? loop.end : start + Math.max(MIN_NOTE, endBeat - at)
    const inLoop = this.#looping && start >= loop.start && start < loop.end
    let clip = track.clips.find((c) => start >= c.start && start < clipEnd(c))
    if (!clip) {
      const clipStart = inLoop ? loop.start : Math.floor(start / beatsPerBar) * beatsPerBar
      track.clips.push(createClip(clipStart, inLoop ? loop.end - loop.start : beatsPerBar))
      clip = track.clips.at(-1)!
      if (track === this.track) this.selectedClip = clip.id
    }
    if (end > clipEnd(clip) && clip.repeat >= clip.length) {
      clip.length = Math.ceil((end - clip.start) / beatsPerBar) * beatsPerBar
      clip.repeat = clip.length
    }
    clip.notes.push({ pitch: note.pitch, start: start - clip.start, length: end - start, velocity: note.velocity })
  }
}

export const studio = new Studio()
