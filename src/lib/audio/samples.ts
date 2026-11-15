import type { Sample } from '../platform'
import { DRUM_RATE, DRUMS, drumKey, renderDrum } from './drums'

/**
 * Pad samples by key: `builtin:<drum id>` are synthesized, `user:<id>` are files the user loaded, kept in
 * IndexedDB so projects stay small and work offline.
 */
const DB = 'keyfall-samples'
const STORE = 'samples'
export const BUILTIN = 'builtin:'
const USER = 'user:'

type Stored = { rate: number; data: Float32Array<ArrayBuffer>; name: string }

const cache = new Map<string, Promise<Sample | null>>()

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** A fresh set of pads for kit `kit` (see `KITS`). */
export const kitPads = (kit: string) => DRUMS.map((d) => ({ midi: d.midi, name: d.name, sample: BUILTIN + drumKey(kit, d.id) }))

export function loadSample(key: string): Promise<Sample | null> {
  const known = cache.get(key)
  if (known) return known
  const found: Promise<Sample | null> = key.startsWith(BUILTIN)
    ? Promise.resolve(renderDrum(key.slice(BUILTIN.length))).then((data) => data && { root: 60, rate: DRUM_RATE, data })
    : transact<Stored | undefined>('readonly', (store) => store.get(key)).then(
        (stored) => (stored ? { root: 60, rate: stored.rate, data: stored.data } : null),
        () => null,
      )
  cache.set(key, found)
  return found
}

/** Decodes an audio file to mono, stores it and returns its key. */
export async function importSample(file: File): Promise<string> {
  const context = new OfflineAudioContext(1, 1, 44_100)
  const buffer = await context.decodeAudioData(await file.arrayBuffer())
  const data = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) data[i] += channel[i] / buffer.numberOfChannels
  }
  const key = USER + Math.random().toString(36).slice(2, 12)
  await transact('readwrite', (store) => store.put({ rate: buffer.sampleRate, data, name: file.name } satisfies Stored, key))
  cache.delete(key)
  return key
}
