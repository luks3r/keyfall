import { engine, PEER_CHANNELS, type SoundData } from '../audio/engine.svelte'
import { sound } from '../audio/sound.svelte'
import { platform, type HostInfo, type Socket } from '../platform'
import type { NetLink, Player, Transport } from '../player.svelte'
import { parseMidiBytes, toMidi, type Song } from '../song'
import {
  decodeBlob,
  decodeRelayed,
  encodeBlobPut,
  encodeEvent,
  ERROR_TEXT,
  tokenFor,
  VERSION,
  wireTime,
  type ErrorCode,
  type Event,
  type Frame,
} from './protocol'

export type Profile = { name: string; seat: number | null; sound: SoundData }

export type Peer = {
  id: number
  tag: string
  profile: Profile | null
  color: string
  channel: number
  held: Set<number>
}

export type ServerInfo = { v: number; name: string; caps: { maxRooms: number; rooms: number; maxBlob: number }; urls: string[]; now: number }
export type RoomInfo = {
  code: string
  name: string
  host: string
  players: number
  spectators: number
  maxPlayers: number | null
  locked: boolean
  mode: string | null
  song: string | null
}
export type RoomOptions = { name: string; public: boolean; pin: string; maxPlayers: number | null }
export type Listing = { server: string; info: ServerInfo; rooms: RoomInfo[]; ping: number }

type SharedSong = { name: string; hash: string }
type SharedTransport = Transport & { at: number }
type RoomDetails = { code: string; name: string; public: boolean; locked: boolean; maxPlayers: number | null }

type ServerMessage =
  | ({ t: 'info' } & ServerInfo)
  | { t: 'rooms'; rooms: RoomInfo[] }
  | {
      t: 'welcome'
      you: number
      tag: string
      host: number
      owner: boolean
      room: RoomDetails
      peers: { id: number; tag: string; profile: Profile | null }[]
      state: { song?: SharedSong; transport?: SharedTransport }
      profile: Profile
      now: number
      urls: string[]
    }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong'; c: number; s: number }
  | { t: 'join'; id: number; tag: string; profile: Profile | null }
  | { t: 'leave'; id: number }
  | { t: 'host'; id: number }
  | { t: 'stored'; hash: string }
  | { t: 'set'; from: number; key: 'profile'; value: Profile }
  | { t: 'set'; from: number; key: 'song'; value: SharedSong }
  | { t: 'set'; from: number; key: 'transport'; value: SharedTransport }
  | { t: 'say'; from: number; value: unknown }

export type RoomStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting'

const STORAGE_KEY = 'keyfall.room.v1'
const PALETTE = ['#f472b6', '#60a5fa', '#34d399', '#c084fc', '#fb923c', '#facc15', '#2dd4bf', '#f87171']
const PING_MS = 3000
const TRANSPORT_MS = 500
const PROFILE_THROTTLE_MS = 150
const RECENT_SERVERS = 5
const RECONNECT_ATTEMPTS = 6
const RECONNECT_MAX_MS = 8000
const PROBE_TIMEOUT_MS = 3000
const BLOB_TIMEOUT_MS = 10_000
export const DEFAULT_PORT = 7777

/** Accepts `host`, `host:port`, `http(s)://…` or `ws(s)://…` and returns the socket URL. */
export function socketUrl(server: string) {
  const trimmed = server.trim().replace(/\/+$/, '')
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed.includes(':') ? trimmed : `${trimmed}:${DEFAULT_PORT}`}`
  const url = new URL(withScheme)
  url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
  url.pathname = '/ws'
  return url.toString()
}

export function inviteUrl(server: string, code: string) {
  const url = new URL(socketUrl(server))
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = '/'
  url.hash = `room=${code}`
  return url.toString()
}

const serverKey = (server: string) => new URL(socketUrl(server || location.host)).host

type Stored = { name: string; server: string; recent: string[] }

function loadStored(): Stored {
  const defaults: Stored = { name: '', server: '', recent: [] }
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') }
  } catch {
    return defaults
  }
}

const stored = loadStored()
const songs = new Map<string, Uint8Array<ArrayBuffer>>()

class ProtocolError extends Error {
  constructor(readonly code: ErrorCode) {
    super(ERROR_TEXT[code] ?? code)
  }
}

/** Connects and completes the `hello` → `info` handshake. */
async function open(server: string): Promise<{ socket: Socket; info: ServerInfo }> {
  const socket = await platform.connect(socketUrl(server || location.host))
  const info = await new Promise<ServerInfo>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('No answer')), PROBE_TIMEOUT_MS)
    socket.onmessage = (frame) => {
      if (typeof frame !== 'string') return
      const message = JSON.parse(frame) as ServerMessage
      clearTimeout(timeout)
      if (message.t === 'info') resolve(message)
      else if (message.t === 'error') reject(new ProtocolError(message.code))
    }
    socket.onclose = () => reject(new Error('Closed'))
    socket.send(JSON.stringify({ t: 'hello', v: VERSION, token: tokenFor(serverKey(server)) }))
  }).catch((error) => {
    socket.close()
    throw error
  })
  return { socket, info }
}

/** Server info, its public rooms and the round trip it took — without joining anything. */
export async function probe(server: string): Promise<Listing> {
  const { socket, info } = await open(server)
  try {
    const started = performance.now()
    const rooms = await new Promise<RoomInfo[]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No answer')), PROBE_TIMEOUT_MS)
      socket.onmessage = (frame) => {
        if (typeof frame !== 'string') return
        const message = JSON.parse(frame) as ServerMessage
        if (message.t !== 'rooms') return
        clearTimeout(timeout)
        resolve(message.rooms)
      }
      socket.send(JSON.stringify({ t: 'list' }))
    })
    return { server, info, rooms, ping: Math.round(performance.now() - started) }
  } finally {
    socket.close()
  }
}

type Intent = { kind: 'create'; options: RoomOptions } | { kind: 'join'; code: string; pin: string }

export class Room implements NetLink {
  status = $state<RoomStatus>('idle')
  error = $state('')
  errorCode = $state<ErrorCode | null>(null)
  details = $state<RoomDetails | null>(null)
  me = $state(0)
  tag = $state('')
  host = $state(0)
  owner = $state(false)
  seat = $state<number | null>(null)
  peers = $state.raw(new Map<number, Peer>())
  name = $state(stored.name || `Player ${Math.floor(Math.random() * 900 + 100)}`)
  server = $state(stored.server)
  recent = $state<string[]>(stored.recent)
  hosting = $state<HostInfo | null>(null)
  lanUrls = $state<string[]>([])
  ping = $state<number | null>(null)

  isHost = $derived(this.status === 'connected' && this.me === this.host)
  code = $derived(this.details?.code ?? '')

  #player: Player
  #socket?: Socket
  #offset = 0
  #bestRtt = Infinity
  #stopEffects?: () => void
  #timers: ReturnType<typeof setInterval>[] = []
  #intent: Intent | null = null
  #attempt = 0
  #retry?: ReturnType<typeof setTimeout>
  #pendingBlobs = new Map<string, (data: Uint8Array<ArrayBuffer>) => void>()
  #pendingStore: ((hash: string) => void)[] = []

  constructor(player: Player) {
    this.#player = player
    void platform.hosting?.().then((info) => (this.hosting = info))
  }

  /** Invite link others can open; prefers the LAN address while hosting from this device. */
  get invite() {
    if (!this.code) return ''
    const server = this.server || location.host
    const loopback = /^(localhost|127\.|\[?::1\]?)/.test(server.replace(/^[a-z]+:\/\//i, ''))
    return inviteUrl(this.hosting?.urls[0] ?? ((loopback && this.lanUrls[0]) || server), this.code)
  }

  async startHosting() {
    this.hosting = await platform.host!(DEFAULT_PORT, this.name)
    this.server = `127.0.0.1:${this.hosting.port}`
  }

  async stopHosting() {
    if (this.server === `127.0.0.1:${this.hosting?.port}`) {
      this.leave()
      this.server = ''
    }
    await platform.stopHost?.()
    this.hosting = null
  }

  serverNow() {
    return Date.now() + this.#offset
  }

  occupied(part: number) {
    if (this.seat === part) return true
    for (const peer of this.peers.values()) if (peer.profile?.seat === part) return true
    return false
  }

  nameOf(owner: number) {
    return this.peers.get(owner)?.profile?.name ?? `Player ${owner}`
  }

  peerColor(owner: number) {
    return this.peers.get(owner)?.color
  }

  *remoteHeld() {
    for (const peer of this.peers.values()) for (const midi of peer.held) yield [midi, peer.color] as const
  }

  noteOn(midi: number, velocity: number) {
    this.#event({ kind: 'on', midi, velocity, t: wireTime(this.serverNow()) })
  }

  noteOff(midi: number) {
    this.#event({ kind: 'off', midi, t: wireTime(this.serverNow()) })
  }

  sustain(on: boolean) {
    this.#event({ kind: 'sustain', on, t: wireTime(this.serverNow()) })
  }

  hit(index: number) {
    this.#event({ kind: 'hit', index })
  }

  shareTransport() {
    if (this.isHost) this.#set('transport', { ...this.#player.transport, at: this.serverNow() })
  }

  shareSong(song: Song) {
    if (!this.isHost) return
    void toMidi(song)
      .then((bytes) => this.#store(bytes))
      .then((hash) => this.#set('song', { name: song.name, hash }))
      .catch((error) => (this.error = String(error)))
  }

  setSeat(seat: number | null) {
    this.seat = seat
    this.#player.dirty = true
  }

  kick(id: number) {
    this.#send({ t: 'kick', id })
  }

  create(options: RoomOptions) {
    return this.#begin({ kind: 'create', options })
  }

  join(code: string, pin = '') {
    return this.#begin({ kind: 'join', code: code.trim().toUpperCase(), pin })
  }

  leave() {
    this.#intent = null
    this.#attempt = 0
    clearTimeout(this.#retry)
    this.#teardown()
    this.status = 'idle'
    this.details = null
    this.seat = null
  }

  async #begin(intent: Intent) {
    this.leave()
    this.#intent = intent
    this.error = ''
    this.errorCode = null
    await this.#connect()
  }

  async #connect() {
    const intent = this.#intent
    if (!intent) return
    this.status = this.#attempt ? 'reconnecting' : 'connecting'
    try {
      const { socket, info } = await open(this.server)
      if (this.#intent !== intent) return socket.close()
      this.#socket = socket
      this.lanUrls = info.urls
      this.#offset = info.now - Date.now()
      socket.onmessage = (frame, played) => this.#receive(frame, played)
      socket.onclose = () => {
        if (this.#socket !== socket) return
        this.#socket = undefined
        this.#reconnect()
      }
      const profile: Profile = { name: this.name, seat: this.seat, sound: sound.encoded }
      if (intent.kind === 'create') {
        const { name, public: isPublic, pin, maxPlayers } = intent.options
        this.#send({ t: 'create', room: { name, public: isPublic, pin: pin || null, maxPlayers }, profile })
      } else {
        this.#send({ t: 'join', code: intent.code, pin: intent.pin || null, profile })
      }
    } catch (error) {
      console.warn(error)
      if (this.#attempt) return this.#reconnect()
      this.#fail(
        error instanceof ProtocolError
          ? error.code
          : null,
        error instanceof ProtocolError
          ? error.message
          : this.server
            ? `No room server answers at ${this.server}.`
            : 'No room server behind this page. Run "bun run room:dev", host from the desktop app, or enter a server address.',
      )
    }
  }

  #fail(code: ErrorCode | null, message: string) {
    const intent = this.#intent
    this.leave()
    if (intent?.kind === 'join' && code === 'pin') this.#intent = null
    this.errorCode = code
    this.error = message
  }

  #reconnect() {
    this.#teardown()
    if (!this.#intent || this.#attempt >= RECONNECT_ATTEMPTS) {
      const hadIntent = !!this.#intent
      this.leave()
      if (hadIntent) this.error = 'Connection lost.'
      return
    }
    this.status = 'reconnecting'
    const delay = Math.min(RECONNECT_MAX_MS, 1000 * 2 ** this.#attempt++)
    this.#retry = setTimeout(() => void this.#connect(), delay)
  }

  #remember() {
    if (this.server) this.recent = [this.server, ...this.recent.filter((s) => s !== this.server)].slice(0, RECENT_SERVERS)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: this.name, server: this.server, recent: this.recent }))
    } catch {}
  }

  #teardown() {
    const socket = this.#socket
    this.#socket = undefined
    socket?.close()
    this.#stopEffects?.()
    this.#stopEffects = undefined
    this.#timers.forEach(clearInterval)
    this.#timers = []
    for (const peer of this.peers.values()) this.#silencePeer(peer)
    this.peers = new Map()
    this.#player.net = null
    this.#player.dirty = true
    this.#bestRtt = Infinity
    this.ping = null
  }

  #send(message: object) {
    this.#socket?.send(JSON.stringify(message))
  }

  #event(event: Event) {
    this.#socket?.send(encodeEvent(event))
  }

  #set(key: string, value: unknown) {
    this.#send({ t: 'set', key, value })
  }

  #store(bytes: Uint8Array<ArrayBuffer>) {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Upload timed out')), BLOB_TIMEOUT_MS)
      this.#pendingStore.push((hash) => {
        clearTimeout(timeout)
        songs.set(hash, bytes)
        resolve(hash)
      })
      this.#socket?.send(encodeBlobPut(bytes))
    })
  }

  #fetch(hash: string) {
    const cached = songs.get(hash)
    if (cached) return Promise.resolve(cached)
    return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Song download timed out')), BLOB_TIMEOUT_MS)
      this.#pendingBlobs.set(hash, (data) => {
        clearTimeout(timeout)
        songs.set(hash, data)
        resolve(data)
      })
      this.#send({ t: 'get', hash })
    })
  }

  #peer(id: number, tag = '', profile: Profile | null = null): Peer {
    const peer: Peer = {
      id,
      tag,
      profile: null,
      color: PALETTE[id % PALETTE.length],
      channel: 1 + (id % PEER_CHANNELS),
      held: new Set(),
    }
    this.#setProfile(peer, profile)
    this.#socket?.route?.(id, peer.channel)
    return peer
  }

  #updatePeers(update: (peers: Map<number, Peer>) => void) {
    const peers = new Map(this.peers)
    update(peers)
    this.peers = peers
    this.#player.dirty = true
  }

  #setProfile(peer: Peer, profile: Profile | null) {
    const soundChanged = JSON.stringify(peer.profile?.sound) !== JSON.stringify(profile?.sound)
    peer.profile = profile
    if (profile?.sound && soundChanged) void engine.setSound(peer.channel, profile.sound)
  }

  #silencePeer(peer: Peer) {
    this.#socket?.route?.(peer.id, null)
    engine.releaseChannel(peer.channel)
    peer.held.clear()
  }

  #receive(frame: Frame, played: boolean) {
    if (typeof frame !== 'string') return this.#receiveBinary(frame, played)
    const message = JSON.parse(frame) as ServerMessage
    const player = this.#player
    switch (message.t) {
      case 'welcome': {
        this.me = message.you
        this.tag = message.tag
        this.host = message.host
        this.owner = message.owner
        this.details = message.room
        this.seat = message.profile.seat
        this.peers = new Map(message.peers.map(({ id, tag, profile }) => [id, this.#peer(id, tag, profile)]))
        this.status = 'connected'
        this.#attempt = 0
        this.#intent = { kind: 'join', code: message.room.code, pin: this.#intent?.kind === 'join' ? this.#intent.pin : (this.#intent?.options.pin ?? '') }
        this.#remember()
        player.net = this
        if (message.state.song) void this.#applySong(message.state.song, message.state.transport)
        else if (message.state.transport) this.#applyTransport(message.state.transport)
        else if (this.isHost) {
          this.shareSong(player.song)
          this.shareTransport()
        }
        this.#start()
        return
      }
      case 'error':
        if (this.status !== 'connected') return this.#fail(message.code, ERROR_TEXT[message.code] ?? message.message)
        this.error = ERROR_TEXT[message.code] ?? message.message
        if (message.code === 'full') this.setSeat(null)
        if (message.code === 'banned') this.#fail(message.code, this.error)
        return
      case 'pong': {
        const rtt = Date.now() - message.c
        this.ping = rtt
        if (rtt <= this.#bestRtt * 1.5) {
          this.#bestRtt = Math.min(this.#bestRtt, rtt)
          this.#offset = message.s - (message.c + rtt / 2)
        }
        return
      }
      case 'stored':
        this.#pendingStore.shift()?.(message.hash)
        return
      case 'join':
        return this.#updatePeers((peers) => peers.set(message.id, this.#peer(message.id, message.tag, message.profile)))
      case 'leave':
        return this.#updatePeers((peers) => {
          const peer = peers.get(message.id)
          if (peer) this.#silencePeer(peer)
          peers.delete(message.id)
        })
      case 'host':
        this.host = message.id
        return
      case 'set':
        if (message.key === 'profile') {
          return this.#updatePeers((peers) => {
            const peer = peers.get(message.from) ?? this.#peer(message.from)
            this.#setProfile(peer, message.value)
            peers.set(message.from, { ...peer })
          })
        }
        if (message.key === 'song') return void this.#applySong(message.value)
        if (message.key === 'transport') return this.#applyTransport(message.value)
        return
    }
  }

  #receiveBinary(frame: Uint8Array<ArrayBuffer>, played: boolean) {
    const blob = decodeBlob(frame)
    if (blob) {
      this.#pendingBlobs.get(blob.hash)?.(blob.data)
      this.#pendingBlobs.delete(blob.hash)
      return
    }
    const relayed = decodeRelayed(frame)
    if (relayed) this.#applyEvent(relayed.from, relayed.event, played)
  }

  async #applySong(shared: SharedSong, transport?: SharedTransport) {
    try {
      const bytes = await this.#fetch(shared.hash)
      this.#player.applySong(await parseMidiBytes(bytes.buffer, shared.name))
      if (this.seat !== null && this.seat >= this.#player.song.parts.length) this.setSeat(null)
      if (transport) this.#applyTransport(transport)
    } catch (error) {
      this.error = `Can't load shared song: ${error}`
    }
  }

  #applyTransport(transport: SharedTransport) {
    this.#player.applyTransport(transport, Math.max(0, (this.serverNow() - transport.at) / 1000))
  }

  #applyEvent(from: number, event: Event, played: boolean) {
    const peer = this.peers.get(from)
    if (!peer) return
    const player = this.#player
    switch (event.kind) {
      case 'on':
        engine.keyOn(peer.channel, event.midi, event.velocity, played)
        peer.held.add(event.midi)
        if (player.studio) player.sandbox.noteOn(event.midi, event.velocity, from)
        break
      case 'off':
        engine.keyOff(peer.channel, event.midi, played)
        peer.held.delete(event.midi)
        player.sandbox.noteOff(event.midi, from)
        break
      case 'sustain':
        engine.pedal(peer.channel, event.on, played)
        if (player.studio) player.sandbox.pedal(event.on, from)
        break
      case 'hit':
        player.applyHit(event.index)
        break
    }
    player.dirty = true
  }

  #start() {
    const ping = () => this.#send({ t: 'ping', c: Date.now() })
    ping()
    this.#timers.push(
      setInterval(ping, PING_MS),
      setInterval(() => {
        if (this.isHost && this.#player.playing) this.shareTransport()
      }, TRANSPORT_MS),
    )

    let pending: ReturnType<typeof setTimeout> | undefined
    let first = true
    this.#stopEffects = $effect.root(() => {
      $effect(() => {
        const profile: Profile = { name: this.name, seat: this.seat, sound: sound.encoded }
        if (first) return void (first = false)
        clearTimeout(pending)
        pending = setTimeout(() => this.#set('profile', profile), PROFILE_THROTTLE_MS)
      })
    })
  }
}
