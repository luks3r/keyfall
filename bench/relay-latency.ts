// One-way relay latency between two players of one room, timed with sub-millisecond precision.
// Run against an idle server, or alongside bench/relay.k6.js to see latency under load.
//   bun bench/relay-latency.ts [ws://127.0.0.1:7777/ws] [samples]
const url = process.argv[2] ?? 'ws://127.0.0.1:7777/ws'
const SAMPLES = Number(process.argv[3] ?? 1000)
const PROBE = 0x3f
/** Two messages per sample at 8–12 ms keeps well under the server's per-connection rate limit. */
const GAP_MS = 8
const JITTER_MS = 4

type Peer = { ws: WebSocket; next(match: (m: any) => boolean): Promise<any> }

async function peer(token: string): Promise<Peer> {
  const ws = new WebSocket(url)
  ws.binaryType = 'arraybuffer'
  const waiting: [(m: any) => boolean, (m: any) => void][] = []
  ws.onmessage = ({ data }) => {
    const message = typeof data === 'string' ? JSON.parse(data) : data
    const i = waiting.findIndex(([match]) => match(message))
    if (i >= 0) waiting.splice(i, 1)[0][1](message)
  }
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)))
  const next = (match: (m: any) => boolean) => new Promise<any>((resolve) => waiting.push([match, resolve]))
  ws.send(JSON.stringify({ t: 'hello', v: 1, token: token.padEnd(24, '0') }))
  await next((m) => m.t === 'info')
  return { ws, next }
}

const run = Date.now().toString(36)
const host = await peer(`latency-host-${run}`)
host.ws.send(JSON.stringify({ t: 'create', room: { name: 'latency', public: false }, profile: { name: 'a', seat: 0 } }))
const { room } = await host.next((m) => m.t === 'welcome')
const guest = await peer(`latency-guest-${run}`)
guest.ws.send(JSON.stringify({ t: 'join', code: room.code, profile: { name: 'b', seat: 1 } }))
await guest.next((m) => m.t === 'welcome')

const isProbe = (m: any) => m instanceof ArrayBuffer && new Uint8Array(m)[0] === PROBE
const relay: number[] = []
const roundTrip: number[] = []
for (let i = 0; i < SAMPLES; i++) {
  const arrived = guest.next(isProbe)
  const sent = performance.now()
  host.ws.send(Uint8Array.of(PROBE, i & 0xff))
  await arrived
  relay.push(performance.now() - sent)

  const pong = host.next((m) => m.t === 'pong')
  const pinged = performance.now()
  host.ws.send(JSON.stringify({ t: 'ping', c: 0 }))
  await pong
  roundTrip.push(performance.now() - pinged)
  await Bun.sleep(GAP_MS + Math.random() * JITTER_MS)
}

const stats = (name: string, values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(3)
  console.log(`${name.padEnd(22)} p50 ${at(0.5)}  p95 ${at(0.95)}  p99 ${at(0.99)}  max ${at(1)} ms`)
}
console.log(`${SAMPLES} samples against ${url}`)
stats('relay (peer → peer)', relay)
stats('ping round trip', roundTrip)
process.exit(0)
