import { SCANNER_STOPPED_MESSAGE, type ScanFailed, type ScanStartResult } from '@shared/scan-types'
import type {
  ScannerMessage,
  ScannerQueryKind,
  ScannerQueryOf,
  ScannerQueryResults,
  ScannerRequest,
  ScanVolume,
} from '@shared/scanner-protocol'
import type { SendEvent } from '../ipc/send-event'

/** The part of an Electron `UtilityProcess` the service needs; tests pass a fake. */
export interface ScannerChild {
  postMessage(message: ScannerRequest): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: (code: number) => void): void
  kill(): void
}

export interface ScanServiceDeps {
  /** Forks the scanner utilityProcess. Called lazily, after `app` is ready. */
  forkScanner(): ScannerChild
  sendEvent: SendEvent
  createScanId(): string
  /** Rejects a query that gets no reply in time (default `QUERY_TIMEOUT_MS`). */
  setTimer?(callback: () => void, ms: number): () => void
}

/** The scan the tree queries belong to: the latest one started, kept after it ends. */
export interface CurrentScan {
  scanId: string
  root: string
}

export interface ScanService {
  /** Starts a scan; a running scan is canceled first (one scan at a time). */
  start(root: string, volume: ScanVolume): ScanStartResult
  /** Cancels the active scan; unknown or finished IDs are a no-op. */
  cancel(scanId: string): void
  /** Cancels whatever scan is running (used when the window reloads after a crash). */
  cancelActive(): void
  /** The latest scan, or null before the first scan and after a scanner crash. */
  currentScan(): CurrentScan | null
  /** True while the latest scan is still walking. */
  isScanning(): boolean
  /** Asks the scanner about its tree. Rejects if the scanner is gone or does not answer. */
  query<K extends ScannerQueryKind>(query: ScannerQueryOf<K>): Promise<ScannerQueryResults[K]>
  /** App quit: kill the scanner and send no more events. */
  dispose(): void
}

export const SCAN_CRASH_MESSAGE = SCANNER_STOPPED_MESSAGE
export const SCANNER_GONE_MESSAGE = 'The scanner is not running.'
export const QUERY_TIMEOUT_MESSAGE = 'The scanner did not answer in time.'
/** A refresh rescans a folder, so it gets the same generous limit as every other query. */
export const QUERY_TIMEOUT_MS = 120_000

function isScannerMessage(value: unknown): value is ScannerMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { type?: unknown; payload?: unknown; requestId?: unknown }
  if (record.type === 'reply') return typeof record.requestId === 'number'
  if (record.type !== 'progress' && record.type !== 'done' && record.type !== 'failed') {
    return false
  }
  const payload = record.payload as { scanId?: unknown } | null | undefined
  return typeof payload === 'object' && payload !== null && typeof payload.scanId === 'string'
}

interface PendingQuery {
  resolve(result: unknown): void
  reject(error: Error): void
  clearTimer(): void
}

const defaultTimer = (callback: () => void, ms: number) => {
  const timer = setTimeout(callback, ms)
  return () => clearTimeout(timer)
}

export function createScanService(deps: ScanServiceDeps): ScanService {
  let child: ScannerChild | null = null
  let activeScanId: string | null = null
  let current: CurrentScan | null = null
  let disposed = false
  let nextRequestId = 1
  const pending = new Map<number, PendingQuery>()
  const setTimer = deps.setTimer ?? defaultTimer

  const rejectAll = (message: string) => {
    for (const query of pending.values()) {
      query.clearTimer()
      query.reject(new Error(message))
    }
    pending.clear()
  }

  const ensureChild = (): ScannerChild => {
    if (child) return child
    const forked = deps.forkScanner()
    forked.onMessage((message) => {
      if (disposed || child !== forked || !isScannerMessage(message)) return
      if (message.type === 'reply') {
        const query = pending.get(message.requestId)
        if (query === undefined) return
        pending.delete(message.requestId)
        query.clearTimer()
        if (message.ok) query.resolve(message.result)
        else query.reject(new Error(message.message))
        return
      }
      if (message.payload.scanId !== activeScanId) return // superseded or already finished
      if (message.type === 'progress') {
        deps.sendEvent('scan:progress', message.payload)
      } else if (message.type === 'failed') {
        activeScanId = null
        deps.sendEvent('scan:failed', message.payload)
      } else {
        activeScanId = null
        deps.sendEvent('scan:done', message.payload)
      }
    })
    forked.onExit(() => {
      if (child !== forked) return
      child = null
      const heldTree = current // the tree lived in the process that just ended
      current = null
      rejectAll(SCAN_CRASH_MESSAGE)
      if (disposed) return
      // A running scan fails; so does a finished one whose tree was held (the renderer's rows
      // and treemap now point at nothing), so the workspace never breaks silently.
      const failedScanId = activeScanId ?? heldTree?.scanId ?? null
      activeScanId = null
      if (failedScanId === null) return
      const failed: ScanFailed = { scanId: failedScanId, message: SCAN_CRASH_MESSAGE }
      deps.sendEvent('scan:failed', failed)
    })
    child = forked
    return forked
  }

  return {
    start(root, volume) {
      if (disposed) throw new Error('The scan service has been shut down.')
      const scanner = ensureChild()
      if (activeScanId !== null) scanner.postMessage({ type: 'cancel', scanId: activeScanId })
      const scanId = deps.createScanId()
      activeScanId = scanId
      current = { scanId, root }
      scanner.postMessage({ type: 'start', scanId, root, volume })
      return { scanId }
    },

    cancel(scanId) {
      if (scanId === activeScanId) child?.postMessage({ type: 'cancel', scanId })
    },

    cancelActive() {
      if (activeScanId !== null) child?.postMessage({ type: 'cancel', scanId: activeScanId })
    },

    currentScan: () => current,

    isScanning: () => activeScanId !== null,

    query<K extends ScannerQueryKind>(query: ScannerQueryOf<K>): Promise<ScannerQueryResults[K]> {
      const scanner = child
      if (disposed || scanner === null) return Promise.reject(new Error(SCANNER_GONE_MESSAGE))
      const requestId = nextRequestId
      nextRequestId += 1
      return new Promise<ScannerQueryResults[K]>((resolve, reject) => {
        const clearTimer = setTimer(() => {
          pending.delete(requestId)
          reject(new Error(QUERY_TIMEOUT_MESSAGE))
        }, QUERY_TIMEOUT_MS)
        pending.set(requestId, {
          resolve: (result) => resolve(result as ScannerQueryResults[K]),
          reject,
          clearTimer,
        })
        try {
          scanner.postMessage({ type: 'query', requestId, query })
        } catch (error) {
          pending.delete(requestId)
          clearTimer()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },

    dispose() {
      disposed = true
      activeScanId = null
      current = null
      rejectAll(SCANNER_GONE_MESSAGE)
      const scanner = child
      child = null
      scanner?.kill()
    },
  }
}
