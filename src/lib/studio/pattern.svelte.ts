import { stepOf, type Clip, type ClipNote } from './project'
import { studio } from './studio.svelte'

/**
 * Pattern speeds, slowest first: each is a step length in beats. A 16-step pattern of 1/16 notes (1×) lasts a bar;
 * at ½× each step is an 1/8 note, so the same steps take two bars.
 */
export const SPEEDS = [1, 1 / 2, 1 / 3, 1 / 4, 1 / 6, 1 / 8] as const
export const SPEED_NAMES = new Map<number, string>([
  [1, '¼× · 1/4 steps'],
  [1 / 2, '½× · 1/8 steps'],
  [1 / 3, '¾× · 1/8T steps'],
  [1 / 4, '1× · 1/16 steps'],
  [1 / 6, '1.5× · 1/16T steps'],
  [1 / 8, '2× · 1/32 steps'],
])
export const MAX_BARS = 16
export const MAX_STEPS = 64

const EPSILON = 1e-6

/** Notes of `clip` that cover any of [from, to). */
export const notesIn = (clip: Clip, pitch: number, from: number, to: number) =>
  clip.notes.filter((n) => n.pitch === pitch && n.start < to - EPSILON && n.start + n.length > from + EPSILON)

/**
 * How the Pattern screen shows and edits a clip; shared by the knobs, soft keys, the step grid and the note grid,
 * so a selection made on one page is the selection on the other.
 */
class PatternView {
  /** Lowest note of melodic rows. */
  base = $state(48)
  /** Velocity of newly drawn steps. */
  velocity = $state(1)
  /** Selected notes; undo replaces note objects, so read it through `selection(clip)`. */
  selected = $state.raw(new Set<ClipNote>())
  /** Where Paste puts notes, in beats from the clip start: after the copied notes, or the last place clicked; each paste moves it on. */
  insert = $state(0)
  /** Copied notes, starting at 0, and the length they tile by. */
  clipboard = $state.raw<{ notes: ClipNote[]; span: number } | null>(null)

  selection(clip: Clip) {
    return clip.notes.filter((n) => this.selected.has(n))
  }

  select(notes: Iterable<ClipNote>) {
    this.selected = new Set(notes)
  }

  /** Copies the selection; `step` rounds the span the copies tile by. */
  copy(clip: Clip, step = stepOf(clip)) {
    const notes = this.selection(clip)
    if (!notes.length) return false
    const from = Math.floor(Math.min(...notes.map((n) => n.start)) / step + EPSILON) * step
    const end = Math.max(...notes.map((n) => n.start + n.length))
    const span = Math.max(step, Math.ceil((end - from) / step - EPSILON) * step)
    this.clipboard = { notes: notes.map((n) => ({ ...n, start: n.start - from })), span }
    // Paste lands right after what was copied unless a click moves the line, so ⌘C ⌘V ⌘V tiles forward.
    this.insert = Math.min(clip.length, from + span)
    return true
  }

  /** Copy, then delete; paste goes back where the notes were taken from. */
  cut(clip: Clip, step = stepOf(clip)) {
    if (!this.copy(clip, step)) return
    this.insert = Math.max(0, this.insert - this.clipboard!.span)
    this.remove(clip)
  }

  /** Pastes at `insert` (notes past the clip end are dropped), selects the copies and moves `insert` past them. */
  paste(clip: Clip) {
    const board = this.clipboard
    if (!board) return
    const at = this.insert
    const notes = board.notes.map((n) => ({ ...n, start: n.start + at })).filter((n) => n.start < clip.length - EPSILON)
    if (!notes.length) return
    studio.edit(() => clip.notes.push(...notes))
    this.select(clip.notes.slice(-notes.length))
    this.insert = Math.min(clip.length, at + board.span)
  }

  /** Copies the selection right after itself and selects the copies. */
  duplicate(clip: Clip, step = stepOf(clip)) {
    const notes = this.selection(clip)
    if (!notes.length) return
    const from = Math.min(...notes.map((n) => n.start))
    const span = Math.ceil((Math.max(...notes.map((n) => n.start + n.length)) - from) / step - EPSILON) * step
    const copies = notes.map((n) => ({ ...n, start: n.start + span })).filter((n) => n.start < clip.length - EPSILON)
    if (!copies.length) return
    studio.edit(() => clip.notes.push(...copies))
    this.select(clip.notes.slice(-copies.length))
  }

  remove(clip: Clip) {
    const notes = new Set(this.selection(clip))
    if (!notes.size) return
    studio.edit(() => (clip.notes = clip.notes.filter((n) => !notes.has(n))))
    this.selected = new Set()
  }

  /** Moves the selection; refuses moves that would push a note out of the clip or the keyboard. */
  move(clip: Clip, beats: number, semitones: number) {
    const notes = this.selection(clip)
    if (!notes.length) return false
    if (!notes.every((n) => n.start + beats >= -EPSILON && n.start + beats < clip.length - EPSILON && n.pitch + semitones >= 0 && n.pitch + semitones <= 127)) return false
    studio.tweak(() => {
      for (const n of notes) {
        n.start = Math.max(0, n.start + beats)
        n.pitch += semitones
      }
    })
    return true
  }

  /** Shifts the selection, or the whole clip when nothing is selected, by one step, wrapping around. */
  rotate(clip: Clip, direction: 1 | -1) {
    const chosen = this.selection(clip)
    const notes = chosen.length ? chosen : clip.notes
    studio.edit(() => {
      for (const note of notes) note.start = (((note.start + direction * stepOf(clip)) % clip.length) + clip.length) % clip.length
    })
  }
  double(clip: Clip) {
    studio.edit(() => {
      const copies: ClipNote[] = clip.notes.map((n) => ({ ...n, start: n.start + clip.length }))
      if (clip.repeat >= clip.length) clip.repeat = clip.length * 2
      clip.length *= 2
      clip.notes.push(...copies)
    })
  }

  clear(clip: Clip) {
    studio.edit(() => (clip.notes = []))
    this.selected = new Set()
  }

  /** Clip length in bars; content repeats unless the clip already loops shorter content. */
  setBars(clip: Clip, bars: number) {
    const length = Math.max(1, Math.min(MAX_BARS, Math.round(bars))) * studio.project.beatsPerBar
    if (length === clip.length) return
    studio.tweak(() => {
      if (clip.repeat >= clip.length) clip.repeat = length
      clip.length = length
    })
  }

  /** Number of steps; the pattern grows or shrinks at its end, whatever the bar size. */
  setSteps(clip: Clip, steps: number) {
    const max = Math.min(MAX_STEPS, Math.floor((MAX_BARS * studio.project.beatsPerBar) / stepOf(clip)))
    const length = Math.max(1, Math.min(max, Math.round(steps))) * stepOf(clip)
    if (Math.abs(length - clip.length) < EPSILON) return
    studio.tweak(() => {
      if (clip.repeat >= clip.length) clip.repeat = length
      clip.length = length
    })
  }

  /**
   * Plays the pattern slower or faster against the tempo: every note keeps its step, and steps get longer or
   * shorter. Returns false when the slower pattern would be too long.
   */
  setSpeed(clip: Clip, step: number) {
    const factor = step / stepOf(clip)
    if (Math.abs(factor - 1) < EPSILON) return true
    if (clip.length * factor > MAX_BARS * studio.project.beatsPerBar + EPSILON) return false
    studio.tweak(() => {
      for (const note of clip.notes) {
        note.start *= factor
        note.length *= factor
      }
      clip.length *= factor
      clip.repeat *= factor
      clip.step = step
    })
    if (studio.stepInput?.clip === clip.id) studio.stepInput.resolution = step
    this.insert *= factor
    return true
  }

  toggleStepInput(clip: Clip) {
    studio.stepInput = studio.stepInput?.clip === clip.id ? null : { clip: clip.id, cursor: 0, resolution: stepOf(clip) }
  }
}

export const patternView = new PatternView()
