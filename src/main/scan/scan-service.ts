import type { ScanFailed, ScanStartResult } from '@shared/scan-types'
import type { ScannerMessage, ScannerRequest } from '@shared/scanner-protocol'
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
}

export interface ScanService {
  /** Starts a scan; a running scan is canceled first (one scan at a time). */
  start(root: string): ScanStartResult
  /** Cancels the active scan; unknown or finished IDs are a no-op. */
  cancel(scanId: string): void
  /** Cancels whatever scan is running (used when the window reloads after a crash). */
  cancelActive(): void
  /** App quit: kill the scanner and send no more events. */
  dispose(): void
}

export const SCAN_CRASH_MESSAGE = 'The scanner process stopped unexpectedly.'

function isScannerMessage(value: unknown): value is ScannerMessage {
  if (typeof value !== 'object' || value === null) return false
  const record = value as { type?: unknown; payload?: unknown }
  if (record.type !== 'progress' && record.type !== 'done') return false
  const payload = record.payload as { scanId?: unknown } | null | undefined
  return typeof payload === 'object' && payload !== null && typeof payload.scanId === 'string'
}

export function createScanService(deps: ScanServiceDeps): ScanService {
  let child: ScannerChild | null = null
  let activeScanId: string | null = null
  let disposed = false

  const ensureChild = (): ScannerChild => {
    if (child) return child
    const forked = deps.forkScanner()
    forked.onMessage((message) => {
      if (disposed || child !== forked || !isScannerMessage(message)) return
      if (message.payload.scanId !== activeScanId) return // superseded or already finished
      if (message.type === 'progress') {
        deps.sendEvent('scan:progress', message.payload)
      } else {
        activeScanId = null
        deps.sendEvent('scan:done', message.payload)
      }
    })
    forked.onExit(() => {
      if (child !== forked) return
      child = null
      if (disposed || activeScanId === null) return
      const failed: ScanFailed = { scanId: activeScanId, message: SCAN_CRASH_MESSAGE }
      activeScanId = null
      deps.sendEvent('scan:failed', failed)
    })
    child = forked
    return forked
  }

  return {
    start(root) {
      if (disposed) throw new Error('The scan service has been shut down.')
      const scanner = ensureChild()
      if (activeScanId !== null) scanner.postMessage({ type: 'cancel', scanId: activeScanId })
      const scanId = deps.createScanId()
      activeScanId = scanId
      scanner.postMessage({ type: 'start', scanId, root })
      return { scanId }
    },

    cancel(scanId) {
      if (scanId === activeScanId) child?.postMessage({ type: 'cancel', scanId })
    },

    cancelActive() {
      if (activeScanId !== null) child?.postMessage({ type: 'cancel', scanId: activeScanId })
    },

    dispose() {
      disposed = true
      activeScanId = null
      const scanner = child
      child = null
      scanner?.kill()
    },
  }
}
