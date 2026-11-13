import wasmUrl from '../src/lib/audio/dsp.wasm?url'
import workletUrl from '../src/lib/audio/worklet.ts?worker&url'
import { APPLIED, command, createRingBuffer, Op, Ring, ringSupported } from '../src/lib/audio/commands'
import type { WorkletOptions } from '../src/lib/audio/worklet'

const SAMPLES = 400
const WARMUP = 100
const ROUNDS = 2
const TIMEOUT_MS = 100
const MAX_GAP_MS = 6

type Mode = 'ring' | 'message'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function percentiles(values: number[]) {
  const sorted = values.toSorted((a, b) => a - b)
  const at = (q: number) => Number(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(3))
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) }
}

async function run() {
  if (!ringSupported()) throw new Error('Page is not cross-origin isolated; SharedArrayBuffer unavailable')
  const ctx = new AudioContext({ latencyHint: 'interactive' })
  const [wasm] = await Promise.all([fetch(wasmUrl).then((r) => r.arrayBuffer()), ctx.audioWorklet.addModule(workletUrl)])
  const ring = new Ring(createRingBuffer())
  const node = new AudioWorkletNode(ctx, 'keyfall', {
    numberOfInputs: 0,
    outputChannelCount: [2],
    processorOptions: { wasm, ring: ring.buffer } satisfies WorkletOptions,
  })
  node.connect(ctx.destination)
  await ctx.resume()
  await sleep(300)

  const send = (mode: Mode, op: number, id: number) => {
    if (mode === 'ring') ring.push(op, id, 0, 60, 0.5)
    else node.port.postMessage({ type: 'command', slot: command(op, id, 0, 60, 0.5) })
  }

  /** Main thread → first rendered block that contains the command. */
  const handOff = async (mode: Mode, count = SAMPLES) => {
    const samples: number[] = []
    let timeouts = 0
    for (let i = 0; i < count; i++) {
      const before = Atomics.load(ring.ints, APPLIED)
      const sent = performance.now()
      send(mode, Op.On, i)
      while (Atomics.load(ring.ints, APPLIED) === before && performance.now() - sent < TIMEOUT_MS);
      if (Atomics.load(ring.ints, APPLIED) === before) timeouts++
      else samples.push(performance.now() - sent)
      send(mode, Op.Off, i)
      await sleep(Math.random() * MAX_GAP_MS)
    }
    return { mode, ...percentiles(samples), timeouts }
  }

  await handOff('ring', WARMUP)
  await handOff('message', WARMUP)
  const results = []
  for (let round = 0; round < ROUNDS; round++) results.push(await handOff('ring'), await handOff('message'))
  const output = { sampleRate: ctx.sampleRate, quantumMs: (128 / ctx.sampleRate) * 1000, baseLatencyMs: ctx.baseLatency * 1000, outputLatencyMs: (ctx.outputLatency || 0) * 1000 }
  await ctx.close()
  return { userAgent: navigator.userAgent, output, handOff: results }
}

Object.assign(window, { bench: run })
