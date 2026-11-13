import type { Platform } from './types'

export type { Device, HostInfo, NearbyHost, Platform, Sample, SequencerConfig, Socket } from './types'

export const isNative = '__TAURI_INTERNALS__' in window
export { isMac } from './os'

export const platform: Platform = isNative
  ? (await import('./native')).createPlatform()
  : (await import('./web')).createPlatform()
