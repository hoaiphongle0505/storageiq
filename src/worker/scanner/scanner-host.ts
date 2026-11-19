import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type { ScannerMessage, ScannerRequest } from '@shared/scanner-protocol'
import { topFolders } from './top-folders'
import { createScanTree, type ScanTree } from './tree'
import { walk, type WalkFs } from './walk'

export const SNAPSHOT_INTERVAL_MS = 250

export interface ScannerHostDeps {
  fs: WalkFs
  post(message: ScannerMessage): void
  now(): number
  /** Calls `tick` every `intervalMs` until the returned function is called. */
  startTicker(tick: () => void, intervalMs: number): () => void
}

export interface ScannerHost {
  handle(request: ScannerRequest): void
  /** Resolves when the most recently started scan has finished. */
  idle(): Promise<void>
  /** The tree of the last finished scan (kept for Phase 3's "children of X" queries). */
  lastTree(): ScanTree | null
}

interface RunningScan {
  scanId: string
  controller: AbortController
  finished: Promise<void>
}

export function parseScannerRequest(data: unknown): ScannerRequest | null {
  if (typeof data !== 'object' || data === null) return null
  const record = data as Record<string, unknown>
  const scanId = record['scanId']
  if (typeof scanId !== 'string') return null
  if (record['type'] === 'start') {
    const root = record['root']
    return typeof root === 'string' ? { type: 'start', scanId, root } : null
  }
  if (record['type'] === 'cancel') return { type: 'cancel', scanId }
  return null
}

export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
  let current: RunningScan | null = null
  let finishedTree: ScanTree | null = null

  const run = async (scanId: string, rootPath: string, signal: AbortSignal): Promise<void> => {
    const tree = createScanTree(rootPath)
    const startedAt = deps.now()
    const snapshot = () => ({
      scanId,
      ...tree.totals(),
      elapsedMs: deps.now() - startedAt,
      topFolders: topFolders(tree),
    })
    const stopTicker = deps.startTicker(() => {
      const progress: ScanProgress = { ...snapshot(), currentPath: tree.currentPath }
      deps.post({ type: 'progress', payload: progress })
    }, SNAPSHOT_INTERVAL_MS)
    try {
      await walk(rootPath, tree.root, tree, { fs: deps.fs, signal })
    } finally {
      stopTicker()
    }
    const done: ScanDone = {
      ...snapshot(),
      status: signal.aborted ? 'canceled' : 'complete',
      errors: [...tree.errors],
      errorCount: tree.errorCount,
    }
    finishedTree = tree
    deps.post({ type: 'done', payload: done })
  }

  return {
    handle(request) {
      if (request.type === 'cancel') {
        if (current?.scanId === request.scanId) current.controller.abort()
        return
      }
      current?.controller.abort() // a new start supersedes the running scan
      const controller = new AbortController()
      const scan: RunningScan = { scanId: request.scanId, controller, finished: Promise.resolve() }
      current = scan
      scan.finished = run(request.scanId, request.root, controller.signal).finally(() => {
        if (current === scan) current = null
      })
    },
    idle: () => current?.finished ?? Promise.resolve(),
    lastTree: () => finishedTree,
  }
}
