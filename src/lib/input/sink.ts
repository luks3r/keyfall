/** Receives played notes. `sounded` means a native fast path already played the audio. */
export interface NoteSink {
  press(midi: number, velocity?: number, sounded?: boolean): void
  release(midi: number, sounded?: boolean): void
  setSustain(on: boolean, sounded?: boolean): void
}
