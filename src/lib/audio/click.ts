import { CLICK_CHANNEL, engine } from './engine.svelte'
import { encodeSynth } from './patch'

const CLICK = encodeSynth({
  attack: 0.001,
  decay: 0.04,
  sustain: 0,
  release: 0.02,
  gain: 0.9,
  keyTrack: false,
  filter: { enabled: false, base: 400, track: 1, env: 0, decay: 1 },
  fm: { enabled: false, ratio: 1, index: 0, decay: 1 },
  partials: [{ ratio: 1, wave: 'square', gain: 0.5, detune: 0 }],
})
const ACCENT_MIDI = 96
const BEAT_MIDI = 89
const CLICK_MS = 60

let loaded = false

/** Installs the click sound on its channel; the engine's metronome plays it too. */
export function ensureClick() {
  if (loaded) return
  loaded = true
  void engine.setSound(CLICK_CHANNEL, { data: Array.from(CLICK), sampled: null })
}

/** Metronome click on its reserved channel; the downbeat is higher. Pitches match crates/dsp/src/sequencer.rs. */
export function click(accent: boolean) {
  ensureClick()
  const voice = engine.noteOn(accent ? ACCENT_MIDI : BEAT_MIDI, 1, CLICK_CHANNEL)
  setTimeout(() => voice.stop(), CLICK_MS)
}
