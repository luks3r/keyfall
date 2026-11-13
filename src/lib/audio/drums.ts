/** A small drum kit synthesized on demand, so the first kit needs no downloads. */

export const DRUM_RATE = 44_100

type Voice = (t: number, noise: () => number) => number

const exp = (t: number, decay: number) => Math.exp(-t / decay)
const sine = (phase: number) => Math.sin(2 * Math.PI * phase)

/** Kick: a pitch sweep from 150 Hz down to 45 Hz. */
const kick: Voice = (t) => sine(45 * t + (105 * 0.04) * (1 - exp(t, 0.04))) * exp(t, 0.35)
const snare: Voice = (t, noise) => 0.5 * sine(185 * t) * exp(t, 0.08) + 0.6 * noise() * exp(t, 0.12)
const clap: Voice = (t, noise) => noise() * (exp(t, 0.12) + [0, 0.012, 0.024].reduce((sum, d) => sum + (t > d ? exp(t - d, 0.01) : 0), 0)) * 0.5
const hat = (decay: number): Voice => (t, noise) => noise() * exp(t, decay) * 0.5
const tom = (hz: number): Voice => (t) => sine(hz * t * (1 + 0.5 * exp(t, 0.05))) * exp(t, 0.25)
const rim: Voice = (t, noise) => (sine(1700 * t) * 0.6 + noise() * 0.3) * exp(t, 0.015)
const cowbell: Voice = (t) => (Math.sign(sine(545 * t)) + Math.sign(sine(800 * t))) * 0.2 * exp(t, 0.12)
const crash: Voice = (t, noise) => noise() * exp(t, 1.2) * 0.4
const ride: Voice = (t, noise) => (noise() * 0.25 + sine(3200 * t) * 0.1) * exp(t, 0.9)
const shaker: Voice = (t, noise) => noise() * Math.sin(Math.PI * Math.min(1, t / 0.08)) * 0.4
const conga = (hz: number): Voice => (t) => sine(hz * t) * exp(t, 0.18)

/** Pads in General MIDI drum order where it exists, laid out bottom-up on a 4×4 grid from C2. */
export const DRUMS: { id: string; name: string; midi: number; length: number; voice: Voice; bright?: boolean }[] = [
  { id: 'kick', name: 'Kick', midi: 36, length: 0.8, voice: kick },
  { id: 'rim', name: 'Rim', midi: 37, length: 0.1, voice: rim },
  { id: 'snare', name: 'Snare', midi: 38, length: 0.5, voice: snare },
  { id: 'clap', name: 'Clap', midi: 39, length: 0.5, voice: clap },
  { id: 'tom-low', name: 'Low tom', midi: 41, length: 0.8, voice: tom(90) },
  { id: 'hat-closed', name: 'Closed hat', midi: 42, length: 0.15, voice: hat(0.03), bright: true },
  { id: 'tom-mid', name: 'Mid tom', midi: 45, length: 0.8, voice: tom(130) },
  { id: 'hat-open', name: 'Open hat', midi: 46, length: 0.6, voice: hat(0.25), bright: true },
  { id: 'tom-high', name: 'High tom', midi: 48, length: 0.7, voice: tom(180) },
  { id: 'crash', name: 'Crash', midi: 49, length: 2.5, voice: crash, bright: true },
  { id: 'ride', name: 'Ride', midi: 51, length: 2, voice: ride, bright: true },
  { id: 'cowbell', name: 'Cowbell', midi: 56, length: 0.4, voice: cowbell },
  { id: 'shaker', name: 'Shaker', midi: 70, length: 0.12, voice: shaker, bright: true },
  { id: 'conga-low', name: 'Low conga', midi: 64, length: 0.5, voice: conga(200) },
  { id: 'conga-high', name: 'High conga', midi: 63, length: 0.5, voice: conga(310) },
  { id: 'clap-2', name: 'Snap', midi: 40, length: 0.2, voice: (t, n) => n() * exp(t, 0.02) * 0.6, bright: true },
]

/** Renders one drum; hats and cymbals use high-passed noise. */
export function renderDrum(id: string): Float32Array<ArrayBuffer> | null {
  const drum = DRUMS.find((d) => d.id === id)
  if (!drum) return null
  let seed = 0x9e3779b9 ^ drum.midi
  let last = 0
  const white = () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 0x80000000 - 1
  }
  const noise = drum.bright
    ? () => {
        const value = white()
        const high = value - last
        last = value
        return high
      }
    : white
  const data = new Float32Array(Math.round(drum.length * DRUM_RATE))
  for (let i = 0; i < data.length; i++) data[i] = drum.voice(i / DRUM_RATE, noise)
  const fade = Math.min(256, data.length)
  for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade
  return data
}
