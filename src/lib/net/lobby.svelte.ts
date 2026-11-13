import { untrack } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import type { Socket } from '../platform'
import { open, reachProblem, type RoomInfo, type ServerInfo } from './room.svelte'

/** What the lobby knows about one server; `rooms` is null until it first answers. */
export type ServerState = {
  status: 'checking' | 'online' | 'offline'
  info: ServerInfo | null
  rooms: RoomInfo[]
  /** Round trip of the last room list, in ms. */
  ping: number | null
  /** Why it is offline, in words a player understands. */
  problem: string
}

/** One server's answer to "is this code yours?" */
export type FindResult = { server: string; room: RoomInfo | null; problem: 'offline' | 'unsupported' | 'too_many' | null }

const REFRESH_MS = 10_000
const ANSWER_MS = 4000


/**
 * Room lists from every server the player knows, kept fresh while the Room screen shows. One connection per
 * server stays open and is asked for its list every few seconds (instead of a new handshake each time), and
 * nothing is polled while the page is hidden.
 */
class Lobby {
  servers = new SvelteMap<string, ServerState>()
  #sockets = new Map<string, Socket>()
  #pending = new Map<string, { started: number; timeout: ReturnType<typeof setTimeout> }>()
  /** Connections being opened, so overlapping refreshes and lookups share one. */
  #opening = new Map<string, Promise<Socket | null>>()
  /** Code lookups waiting for their server's answer. */
  #finds = new Map<string, (answer: Omit<FindResult, 'server'>) => void>()
  #timer: ReturnType<typeof setInterval> | undefined
  #watchers = 0

  /** Keeps `list` fresh until the returned function is called. */
  watch(list: () => string[]) {
    this.#watchers++
    const tick = () => document.visibilityState === 'visible' && this.refresh(list())
    tick()
    if (!this.#timer) this.#timer = setInterval(tick, REFRESH_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      document.removeEventListener('visibilitychange', tick)
      if (--this.#watchers) return
      clearInterval(this.#timer)
      this.#timer = undefined
      for (const server of [...this.#sockets.keys()]) this.#drop(server)
    }
  }

  /** Asks every server in `list` for its rooms now; forgets servers no longer in it. */
  refresh(list: string[]) {
    untrack(() => {
      const wanted = new Set(list)
      for (const server of [...this.servers.keys()]) if (!wanted.has(server)) this.#drop(server, true)
      for (const server of wanted) void this.#ask(server)
    })
  }

  /** The open connection to `server`, opening it if needed; null when it can't be reached. */
  #socket(server: string): Promise<Socket | null> {
    const open_ = this.#sockets.get(server)
    if (open_) return Promise.resolve(open_)
    const opening = this.#opening.get(server)
    if (opening) return opening
    if (!this.servers.has(server)) this.servers.set(server, { status: 'checking', info: null, rooms: [], ping: null, problem: '' })
    const connecting = open(server).then(
      ({ socket, info }) => {
        if (!this.servers.has(server)) return socket.close(), null
        this.#sockets.set(server, socket)
        this.#update(server, { info })
        socket.onmessage = (frame) => this.#receive(server, frame)
        socket.onclose = () => {
          if (this.#sockets.get(server) !== socket) return
          this.#sockets.delete(server)
          this.#settle(server)
          this.#finds.get(server)?.({ room: null, problem: 'offline' })
          this.#update(server, { status: 'offline', problem: reachProblem(server) })
        }
        return socket
      },
      (error) => {
        if (this.servers.has(server)) this.#update(server, { status: 'offline', problem: reachProblem(server, error) })
        return null
      },
    )
    this.#opening.set(server, connecting)
    void connecting.finally(() => this.#opening.delete(server))
    return connecting
  }

  async #ask(server: string) {
    if (this.#pending.has(server) || this.#opening.has(server)) return
    const socket = await this.#socket(server)
    if (!socket || this.#pending.has(server)) return
    const timeout = setTimeout(() => {
      this.#settle(server)
      this.#update(server, { status: 'offline', problem: reachProblem(server) })
    }, ANSWER_MS)
    this.#pending.set(server, { started: performance.now(), timeout })
    socket.send(JSON.stringify({ t: 'list' }))
  }

  /**
   * Asks every server in `list` at once whether `code` is one of its rooms. Servers that don't know the `find`
   * question (older ones) say so with `unsupported`; joining can still try them one by one.
   */
  find(code: string, list: string[]): Promise<FindResult[]> {
    return Promise.all(
      [...new Set(list)].map(async (server): Promise<FindResult> => {
        const socket = await this.#socket(server)
        if (!socket) return { server, room: null, problem: 'offline' }
        this.#finds.get(server)?.({ room: null, problem: 'offline' })
        const answer = await new Promise<Omit<FindResult, 'server'>>((resolve) => {
          const timeout = setTimeout(() => done({ room: null, problem: 'offline' }), ANSWER_MS)
          const done = (result: Omit<FindResult, 'server'>) => {
            clearTimeout(timeout)
            if (this.#finds.get(server) === done) this.#finds.delete(server)
            resolve(result)
          }
          this.#finds.set(server, done)
          socket.send(JSON.stringify({ t: 'find', code }))
        })
        return { server, ...answer }
      }),
    )
  }

  #receive(server: string, frame: string | Uint8Array<ArrayBuffer>) {
    if (typeof frame !== 'string') return
    const message = JSON.parse(frame) as { t: string; rooms?: RoomInfo[]; room?: RoomInfo | null; code?: string }
    const find = this.#finds.get(server)
    if (find && message.t === 'found') return find({ room: message.room ?? null, problem: null })
    if (find && message.t === 'error') return find({ room: null, problem: message.code === 'too_many' ? 'too_many' : 'unsupported' })
    const pending = this.#pending.get(server)
    if (message.t !== 'rooms' || !pending) return
    this.#settle(server)
    this.#update(server, { status: 'online', rooms: message.rooms ?? [], ping: Math.round(performance.now() - pending.started), problem: '' })
  }

  #settle(server: string) {
    clearTimeout(this.#pending.get(server)?.timeout)
    this.#pending.delete(server)
  }

  #update(server: string, change: Partial<ServerState>) {
    const current = this.servers.get(server) ?? { status: 'checking', info: null, rooms: [], ping: null, problem: '' }
    this.servers.set(server, { ...current, ...change })
  }

  #drop(server: string, forget = false) {
    this.#settle(server)
    const socket = this.#sockets.get(server)
    this.#sockets.delete(server)
    socket?.close()
    if (forget) this.servers.delete(server)
  }
}

export const lobby = new Lobby()

/** Signal strength for a ping: 3 bars is great, 1 is slow, 0 is unreachable. */
export const bars = (state: ServerState | undefined) =>
  !state || state.status !== 'online' || state.ping === null ? 0 : state.ping < 80 ? 3 : state.ping < 200 ? 2 : 1
