// Same workload as crates/dsp/examples/render.rs, on the WASM build the browser's audio worklet runs.
//   bun run wasm && bun bench/dsp-wasm.ts
const SAMPLE_RATE = 48_000
const BLOCK = 128
const BLOCKS = 4_000
const VOICES = [1, 8, 16, 32, 64]

type Dsp = {
  memory: WebAssembly.Memory
  engine_new(rate: number): number
  note_on(engine: number, id: number, channel: number, midi: number, velocity: number): void
  alloc(len: number): number
  set_instrument(engine: number, channel: number, ptr: number, len: number): number
  add_sample(engine: number, root: number, rate: number, ptr: number, len: number): void
  render(engine: number, frames: number): number
}

const wasm = await Bun.file(new URL('../src/lib/audio/dsp.wasm', import.meta.url)).arrayBuffer()
const instantiate = async () => (await WebAssembly.instantiate(wasm, {})).instance.exports as unknown as Dsp

const copy = (dsp: Dsp, floats: Float32Array) => {
  const ptr = dsp.alloc(floats.byteLength)
  new Float32Array(dsp.memory.buffer, ptr, floats.length).set(floats)
  return ptr
}

const heavySynth = () => {
  const data = [0, 0.004, 4, 0.6, 0.3, 1, 1, 1, 400, 1.5, 2, 1, 1, 2, 1.5, 0.4, 8]
  for (let i = 0; i < 8; i++) data.push(1 + i, i % 4, 0.2, 3)
  return Float32Array.from(data)
}

function loadSamples(dsp: Dsp, engine: number) {
  const data = Float32Array.from({ length: SAMPLE_RATE * 8 }, (_, i) => Math.sin(i * 0.05) * 0.5)
  for (let root = 21; root <= 108; root += 3) dsp.add_sample(engine, root, SAMPLE_RATE, copy(dsp, data), data.length)
  return Float32Array.of(1, 0.3, 1)
}

async function measure(name: string, instrument: (dsp: Dsp, engine: number) => Float32Array) {
  const budget = (BLOCK / SAMPLE_RATE) * 1e6
  for (const voices of VOICES) {
    const dsp = await instantiate()
    const engine = dsp.engine_new(SAMPLE_RATE)
    const patch = instrument(dsp, engine)
    dsp.set_instrument(engine, 0, copy(dsp, patch), patch.length)
    for (let v = 0; v < voices; v++) dsp.note_on(engine, v, 0, 36 + v, 0.8)
    let worst = 0
    const started = performance.now()
    for (let b = 0; b < BLOCKS; b++) {
      const block = performance.now()
      dsp.render(engine, BLOCK)
      worst = Math.max(worst, (performance.now() - block) * 1000)
    }
    const mean = ((performance.now() - started) * 1000) / BLOCKS
    const share = ((mean / budget) * 100).toFixed(2).padStart(5)
    console.log(`${name.padEnd(7)} ${String(voices).padStart(2)} voices  mean ${mean.toFixed(2).padStart(6)} µs (${share}% of ${budget.toFixed(0)} µs)  worst ${worst.toFixed(1).padStart(6)} µs`)
  }
}

console.log(`WASM: ${BLOCK}-frame blocks at ${SAMPLE_RATE} Hz, ${BLOCKS} blocks per row`)
await measure('synth', () => heavySynth())
await measure('sampler', loadSamples)
