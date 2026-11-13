/** Client side of `crates/room/PROTOCOL.md` (v1). */

export const VERSION = 1

export const Kind = {
  NoteOn: 0x01,
  NoteOff: 0x02,
  Sustain: 0x03,
  Hit: 0x04,
  BlobPut: 0x40,
  BlobData: 0x41,
} as const

export type Frame = string | Uint8Array<ArrayBuffer>

export type Event =
  | { kind: 'on'; midi: number; velocity: number; t: number }
  | { kind: 'off'; midi: number; t: number }
  | { kind: 'sustain'; on: boolean; t: number }
  | { kind: 'hit'; index: number }

const SENDER_BYTES = 2
const HASH_BYTES = 32
const VELOCITY_MAX = 127
const TIME_MASK = 0xffff

export const wireTime = (serverMs: number) => Math.floor(serverMs) & TIME_MASK

export function encodeEvent(event: Event): Uint8Array<ArrayBuffer> {
  switch (event.kind) {
    case 'on': {
      const velocity = Math.max(1, Math.min(VELOCITY_MAX, Math.round(event.velocity * VELOCITY_MAX)))
      return Uint8Array.of(Kind.NoteOn, event.midi, velocity, event.t & 0xff, event.t >> 8)
    }
    case 'off':
      return Uint8Array.of(Kind.NoteOff, event.midi, event.t & 0xff, event.t >> 8)
    case 'sustain':
      return Uint8Array.of(Kind.Sustain, Number(event.on), event.t & 0xff, event.t >> 8)
    case 'hit': {
      const frame = new Uint8Array(5)
      frame[0] = Kind.Hit
      new DataView(frame.buffer).setUint32(1, event.index, true)
      return frame
    }
  }
}

/** Decodes a relayed event `[kind][from u16][payload]`; unknown kinds return null. */
export function decodeRelayed(frame: Uint8Array): { from: number; event: Event } | null {
  if (frame.length < 1 + SENDER_BYTES) return null
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
  const from = view.getUint16(1, true)
  const at = 1 + SENDER_BYTES
  const time = (offset: number) => view.getUint16(at + offset, true)
  switch (frame[0]) {
    case Kind.NoteOn:
      return frame.length === at + 4 ? { from, event: { kind: 'on', midi: frame[at], velocity: frame[at + 1] / VELOCITY_MAX, t: time(2) } } : null
    case Kind.NoteOff:
      return frame.length === at + 3 ? { from, event: { kind: 'off', midi: frame[at], t: time(1) } } : null
    case Kind.Sustain:
      return frame.length === at + 3 ? { from, event: { kind: 'sustain', on: frame[at] !== 0, t: time(1) } } : null
    case Kind.Hit:
      return frame.length === at + 4 ? { from, event: { kind: 'hit', index: view.getUint32(at, true) } } : null
    default:
      return null
  }
}

export function encodeBlobPut(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(data.length + 1)
  frame[0] = Kind.BlobPut
  frame.set(data, 1)
  return frame
}

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

export function decodeBlob(frame: Uint8Array): { hash: string; data: Uint8Array<ArrayBuffer> } | null {
  if (frame[0] !== Kind.BlobData || frame.length < 1 + HASH_BYTES) return null
  return { hash: toHex(frame.subarray(1, 1 + HASH_BYTES)), data: frame.slice(1 + HASH_BYTES) }
}

const TOKENS_KEY = 'keyfall.tokens.v1'
const TOKEN_BYTES = 32

/** Random identity token per server, so a rogue server cannot reuse it elsewhere. Works without a secure context. */
export function tokenFor(server: string): string {
  let tokens: Record<string, string> = {}
  try {
    tokens = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}')
  } catch {}
  tokens[server] ??= toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens))
  } catch {}
  return tokens[server]
}

export type ErrorCode = 'version' | 'protocol' | 'not_found' | 'pin' | 'full' | 'limit' | 'banned' | 'forbidden' | 'too_large'

export const ERROR_TEXT: Record<ErrorCode, string> = {
  version: 'This server speaks a different protocol version.',
  protocol: 'The server rejected a message.',
  not_found: 'No room with that code.',
  pin: 'Wrong or missing PIN.',
  full: 'All player seats are taken.',
  limit: 'The server cannot create more rooms right now.',
  banned: 'You were removed from this room.',
  forbidden: 'Only the host can do that.',
  too_large: 'That file is too large for this server.',
}
