// Room server load test: ROOMS rooms x PLAYERS seated players, each sending RATE notes per second.
// Start a server that allows many rooms from one address first:
//   cargo run -p keyfall-room --release -- --port 7777 --max-rooms 10000 --rooms-per-ip 10000
// Then: k6 run bench/relay.k6.js -e ROOMS=50 -e PLAYERS=4 -e RATE=10 -e DURATION=30
import { check } from 'k6'
import { Counter, Trend } from 'k6/metrics'
import { WebSocket } from 'k6/websockets'

const URL = __ENV.URL ?? 'ws://127.0.0.1:7777/ws'
const ROOMS = Number(__ENV.ROOMS ?? 50)
const PLAYERS = Number(__ENV.PLAYERS ?? 4)
const RATE = Number(__ENV.RATE ?? 10)
const DURATION = Number(__ENV.DURATION ?? 30)
const LIST_RETRY_MS = 200

/** Custom event kind; the server relays unknown kinds in 0x01..=0x3F like notes. */
const PROBE = 0x3f
const PROBE_BYTES = 1 + 8
const RELAYED_BYTES = PROBE_BYTES + 2

export const options = {
  scenarios: {
    players: {
      executor: 'per-vu-iterations',
      vus: ROOMS * PLAYERS,
      iterations: 1,
      maxDuration: `${DURATION + 60}s`,
    },
  },
  thresholds: {
    relay_ms: ['p(95)<10', 'p(99)<25'],
    join_ms: ['p(95)<500'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const relayMs = new Trend('relay_ms', true)
const joinMs = new Trend('join_ms', true)
const sent = new Counter('events_sent')
const received = new Counter('events_received')

function probe() {
  const frame = new ArrayBuffer(PROBE_BYTES)
  const view = new DataView(frame)
  view.setUint8(0, PROBE)
  view.setFloat64(1, Date.now(), true)
  return frame
}

/** One run id shared by every VU, so rooms from earlier runs are never joined. */
export const setup = () => Date.now().toString(36)

export default function (run) {
  const index = __VU - 1
  const room = Math.floor(index / PLAYERS)
  const seat = index % PLAYERS
  const name = `bench-${run}-${room}`
  const profile = { name: `p${seat}`, seat, sound: null }
  const token = `bench-${run}-${index}`.padEnd(24, '0')
  const opened = Date.now()
  const ws = new WebSocket(URL)
  ws.binaryType = 'arraybuffer'
  let sender = 0
  let stopper = 0

  const start = () => {
    joinMs.add(Date.now() - opened)
    sender = setInterval(() => {
      ws.send(probe())
      sent.add(1)
    }, 1000 / RATE)
    stopper = setTimeout(() => ws.close(), DURATION * 1000)
  }

  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 1, token }))
  ws.onclose = () => {
    clearInterval(sender)
    clearTimeout(stopper)
  }
  ws.onerror = (e) => console.error(`socket error: ${e.error}`)
  ws.onmessage = ({ data }) => {
    if (typeof data !== 'string') {
      if (data.byteLength !== RELAYED_BYTES || new Uint8Array(data)[0] !== PROBE) return
      relayMs.add(Date.now() - new DataView(data).getFloat64(3, true))
      received.add(1)
      return
    }
    const message = JSON.parse(data)
    switch (message.t) {
      case 'info':
        if (seat === 0) ws.send(JSON.stringify({ t: 'create', room: { name, public: true, maxPlayers: PLAYERS }, profile }))
        else ws.send(JSON.stringify({ t: 'list' }))
        return
      case 'rooms': {
        const found = message.rooms.find((r) => r.name === name)
        if (found) ws.send(JSON.stringify({ t: 'join', code: found.code, profile }))
        else setTimeout(() => ws.send(JSON.stringify({ t: 'list' })), LIST_RETRY_MS)
        return
      }
      case 'welcome':
        check(message, { joined: (m) => m.profile.seat === seat })
        return start()
      case 'error':
        check(message, { [`no error (${message.code})`]: () => false })
        return ws.close()
    }
  }
}
