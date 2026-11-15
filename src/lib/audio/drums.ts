/** Drum kits synthesized on demand, so kits need no downloads: a studio kit and 808 / 909 style ones. */

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

/** Phase of a sine gliding from `from` Hz to `to` Hz with time constant `time`, as drum machines tune their drums. */
const glide = (t: number, from: number, to: number, time: number) => to * t + (from - to) * time * (1 - exp(t, time))
/** The 808's six detuned square waves, the metal in its hats and cymbals. */
const metal = (t: number) => [205.3, 304.4, 369.6, 522.7, 540, 800].reduce((sum, hz) => sum + Math.sign(sine(hz * 8.5 * t)), 0) / 6
const taps = (t: number, gaps: number[], decay: number) => gaps.reduce((sum, d) => sum + (t > d ? exp(t - d, decay) : 0), 0)

type Variant = { voice: Voice; length?: number }
const KIT_808: Record<string, Variant> = {
  kick: { voice: (t) => Math.tanh(1.6 * sine(glide(t, 130, 48, 0.03))) * exp(t, 0.55), length: 1.6 },
  snare: { voice: (t, noise) => 0.5 * sine(238 * t) * exp(t, 0.07) + 0.3 * sine(476 * t) * exp(t, 0.05) + 0.45 * noise() * exp(t, 0.11) },
  clap: { voice: (t, noise) => noise() * (taps(t, [0, 0.011, 0.022, 0.033], 0.006) + 0.6 * exp(t, 0.18)) * 0.45, length: 0.7 },
  rim: { voice: (t) => (sine(1667 * t) * 0.6 + sine(455 * t) * 0.4) * exp(t, 0.012) },
  'hat-closed': { voice: (t, noise) => (0.35 * metal(t) + 0.35 * noise()) * exp(t, 0.035) },
  'hat-open': { voice: (t, noise) => (0.35 * metal(t) + 0.35 * noise()) * exp(t, 0.3), length: 0.9 },
  'tom-low': { voice: (t) => sine(glide(t, 104, 80, 0.06)) * exp(t, 0.35) },
  'tom-mid': { voice: (t) => sine(glide(t, 143, 110, 0.06)) * exp(t, 0.32) },
  'tom-high': { voice: (t) => sine(glide(t, 195, 150, 0.06)) * exp(t, 0.3) },
  crash: { voice: (t, noise) => (0.3 * noise() + 0.15 * metal(t)) * exp(t, 1.4), length: 3 },
  ride: { voice: (t, noise) => (0.15 * noise() + 0.2 * metal(t * 1.3)) * exp(t, 1), length: 2.5 },
  shaker: { voice: (t, noise) => noise() * exp(t, 0.025) * 0.5 },
  'conga-low': { voice: (t) => sine(glide(t, 253, 220, 0.02)) * exp(t, 0.12) },
  'conga-high': { voice: (t) => sine(glide(t, 380, 330, 0.02)) * exp(t, 0.1) },
  'clap-2': { voice: (t) => sine(2500 * t) * exp(t, 0.02) * 0.7 },
}
const KIT_909: Record<string, Variant> = {
  kick: { voice: (t, noise) => Math.tanh(2.2 * sine(glide(t, 260, 52, 0.018))) * exp(t, 0.32) + noise() * exp(t, 0.004) * 0.35 },
  snare: { voice: (t, noise) => 0.4 * sine(glide(t, 240, 185, 0.02)) * exp(t, 0.06) + 0.25 * sine(330 * t) * exp(t, 0.04) + 0.7 * noise() * exp(t, 0.16) },
  clap: { voice: (t, noise) => noise() * (taps(t, [0, 0.008, 0.016], 0.004) + 0.5 * exp(t, 0.14)) * 0.5 },
  rim: { voice: (t) => (sine(1800 * t) * 0.6 + sine(500 * t) * 0.3) * exp(t, 0.008) },
  'hat-closed': { voice: (t, noise) => (0.55 * noise() + 0.15 * metal(t * 1.2)) * exp(t, 0.04) },
  'hat-open': { voice: (t, noise) => (0.55 * noise() + 0.15 * metal(t * 1.2)) * exp(t, 0.35), length: 0.9 },
  'tom-low': { voice: (t, noise) => sine(glide(t, 150, 95, 0.05)) * exp(t, 0.3) + noise() * exp(t, 0.01) * 0.15 },
  'tom-mid': { voice: (t, noise) => sine(glide(t, 210, 130, 0.05)) * exp(t, 0.28) + noise() * exp(t, 0.01) * 0.15 },
  'tom-high': { voice: (t, noise) => sine(glide(t, 280, 175, 0.05)) * exp(t, 0.25) + noise() * exp(t, 0.01) * 0.15 },
  crash: { voice: (t, noise) => (0.4 * noise() + 0.1 * metal(t)) * exp(t, 1.6), length: 3 },
  ride: { voice: (t, noise) => (0.2 * noise() + 0.2 * metal(t * 1.5)) * exp(t, 1.2), length: 2.5 },
}

/** The kits, by the instrument id a track picks them with. */
export const KITS: { id: string; name: string; variants: Record<string, Variant> }[] = [
  { id: 'kit', name: 'Studio Kit', variants: {} },
  { id: 'kit-808', name: '808 Kit', variants: KIT_808 },
  { id: 'kit-909', name: '909 Kit', variants: KIT_909 },
]

/** The sample key part naming a kit's drum: plain for the studio kit (as saved before kits had variants). */
export const drumKey = (kit: string, drum: string) => (kit === KITS[0].id ? drum : `${kit}/${drum}`)

/** Renders one drum (`drumKey`); hats and cymbals use high-passed noise. */
export function renderDrum(key: string): Float32Array<ArrayBuffer> | null {
  const [kit, id] = key.includes('/') ? key.split('/') : [KITS[0].id, key]
  const drum = DRUMS.find((d) => d.id === id)
  if (!drum) return null
  const variant = KITS.find((k) => k.id === kit)?.variants[id]
  const voice = variant?.voice ?? drum.voice
  const length = variant?.length ?? drum.length
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
  const data = new Float32Array(Math.round(length * DRUM_RATE))
  for (let i = 0; i < data.length; i++) data[i] = voice(i / DRUM_RATE, noise)
  const fade = Math.min(256, data.length)
  for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade
  return data
}
