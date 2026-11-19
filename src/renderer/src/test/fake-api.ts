import { vi } from 'vitest'
import type { AppInfo, SelectFolderResult, StorageIQApi } from '@shared/ipc-contract'
import type { ScanDone, ScanFailed, ScanProgress, ScanStartResult } from '@shared/scan-types'

export const TEST_APP_INFO: AppInfo = {
  name: 'StorageIQ',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '38.0.0',
}

/** A fake bridge plus `emit…` helpers that play the main process sending events. */
export interface FakeApi extends StorageIQApi {
  emitScanProgress(progress: ScanProgress): void
  emitScanDone(done: ScanDone): void
  emitScanFailed(failed: ScanFailed): void
  /** Subscribed event listeners across all channels. */
  listenerCount(): number
}

function createChannel<T>() {
  const listeners = new Set<(payload: T) => void>()
  return {
    subscribe: (listener: (payload: T) => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: (payload: T) => {
      for (const listener of [...listeners]) listener(payload)
    },
    size: () => listeners.size,
  }
}

export function createFakeApi(overrides: Partial<StorageIQApi> = {}): FakeApi {
  const progress = createChannel<ScanProgress>()
  const done = createChannel<ScanDone>()
  const failed = createChannel<ScanFailed>()
  return {
    getAppInfo: vi.fn(async () => TEST_APP_INFO),
    selectFolder: vi.fn(async (): Promise<SelectFolderResult> => ({ canceled: true })),
    startScan: vi.fn(async (): Promise<ScanStartResult> => ({ scanId: 'scan-1' })),
    cancelScan: vi.fn(async () => undefined),
    onScanProgress: vi.fn(progress.subscribe),
    onScanDone: vi.fn(done.subscribe),
    onScanFailed: vi.fn(failed.subscribe),
    ...overrides,
    emitScanProgress: progress.emit,
    emitScanDone: done.emit,
    emitScanFailed: failed.emit,
    listenerCount: () => progress.size() + done.size() + failed.size(),
  }
}
