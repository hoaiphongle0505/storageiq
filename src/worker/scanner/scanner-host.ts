import type { ScanDone, ScanProgress } from '@shared/scan-types'
import type {
  ScannerMessage,
  ScannerQuery,
  ScannerQueryResults,
  ScannerRequest,
  ScanVolume,
} from '@shared/scanner-protocol'
import { MAX_PATH_QUERY_IDS } from '@shared/scanner-protocol'
import { SIZE_MODES, SORT_KEYS, type SizeMode, type SortKey } from '@shared/tree-types'
import {
  ChildSorter,
  childrenPage,
  expandIds,
  nodePaths,
  folderOf,
  nodeDetails,
  resolveNode,
} from './tree-queries'
import { TreeStore } from './tree-store'
import { SideViews } from './side-views'
import { treemapLayout } from './treemap'
import { walk, type DirectoryLister, type WalkSink } from './walk'
import { WalkerStartupError } from './walker-pool'

export const SNAPSHOT_INTERVAL_MS = 250
export const REFRESH_BUSY_MESSAGE = 'A scan is running; refresh it when the scan ends.'
export const ROOT_REFRESH_MESSAGE = 'The scan root is rescanned with a new scan, not refreshed.'

export interface ScannerHostDeps {
  lister: DirectoryLister
  /**
   * Walks a full scan with several worker threads. When absent (tests, `STORAGEIQ_WALKERS=1`) a
   * scan uses the single-thread `walk()`. Refreshing one folder never uses it.
   */
  walkParallel?(
    root: string,
    handle: number,
    sink: WalkSink<number>,
    signal: AbortSignal,
  ): Promise<{ walkers: number }>
  post(message: ScannerMessage): void
  now(): number
  /** Milliseconds since the epoch, for the Age view (`now()` may be a monotonic clock). */
  wallClock?(): number
  /** Calls `tick` every `intervalMs` until the returned function is called. */
  startTicker(tick: () => void, intervalMs: number): () => void
}

export interface ScannerHost {
  handle(request: ScannerRequest): void
  /** Resolves when the most recently started scan (and any refresh) has finished. */
  idle(): Promise<void>
  /** The tree of the latest scan, kept while it runs and after it ends; null before any scan. */
  currentStore(): TreeStore | null
}

interface RunningScan {
  scanId: string
  controller: AbortController
  finished: Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const str = (value: unknown): value is string => typeof value === 'string'
const int = (value: unknown): value is number => Number.isInteger(value)

function parseVolume(value: unknown): ScanVolume | null {
  if (!isRecord(value)) return null
  const clusterBytes = value['clusterBytes']
  const freeBytes = value['freeBytes']
  if (!int(clusterBytes) || clusterBytes <= 0) return null
  if (freeBytes !== null && (typeof freeBytes !== 'number' || freeBytes < 0)) return null
  return { clusterBytes, freeBytes }
}

function parseQuery(value: unknown): ScannerQuery | null {
  if (!isRecord(value) || !str(value['scanId'])) return null
  const scanId = value['scanId']
  const nodeId = value['nodeId']
  const sortKey = value['sortKey']
  const sortDir = value['sortDir']
  const isSort = SORT_KEYS.includes(sortKey as SortKey) && (sortDir === 'asc' || sortDir === 'desc')
  switch (value['kind']) {
    case 'children': {
      const { offset, limit } = value
      if (!str(nodeId) || !isSort || !int(offset) || !int(limit)) return null
      return {
        kind: 'children',
        scanId,
        nodeId,
        sortKey: sortKey as SortKey,
        sortDir: sortDir as 'asc' | 'desc',
        offset,
        limit,
      }
    }
    case 'node':
      if (!str(nodeId) || !isSort) return null
      return {
        kind: 'node',
        scanId,
        nodeId,
        sortKey: sortKey as SortKey,
        sortDir: sortDir as 'asc' | 'desc',
      }
    case 'expand':
      return str(nodeId) && int(value['levels'])
        ? { kind: 'expand', scanId, nodeId, levels: value['levels'] }
        : null
    case 'treemap': {
      const { mode, depth, width, height } = value
      if (!str(nodeId) || !SIZE_MODES.includes(mode as SizeMode)) return null
      if (!int(depth) || !int(width) || !int(height)) return null
      return { kind: 'treemap', scanId, nodeId, mode: mode as SizeMode, depth, width, height }
    }
    case 'top-files': {
      const { mode } = value
      return str(nodeId) && SIZE_MODES.includes(mode as SizeMode)
        ? { kind: 'top-files', scanId, nodeId, mode: mode as SizeMode }
        : null
    }
    case 'types':
      return str(nodeId) ? { kind: 'types', scanId, nodeId } : null
    case 'age':
      return str(nodeId) ? { kind: 'age', scanId, nodeId } : null
    case 'paths': {
      const ids = value['nodeIds']
      if (!Array.isArray(ids) || ids.length > MAX_PATH_QUERY_IDS || !ids.every(str)) return null
      return { kind: 'paths', scanId, nodeIds: ids as string[] }
    }
    case 'refresh':
      return str(nodeId) ? { kind: 'refresh', scanId, nodeId } : null
    case 'totals':
      return { kind: 'totals', scanId }
    default:
      return null
  }
}

export function parseScannerRequest(data: unknown): ScannerRequest | null {
  if (!isRecord(data)) return null
  if (data['type'] === 'query') {
    const requestId = data['requestId']
    const query = parseQuery(data['query'])
    return int(requestId) && query !== null ? { type: 'query', requestId, query } : null
  }
  const scanId = data['scanId']
  if (!str(scanId)) return null
  if (data['type'] === 'start') {
    const root = data['root']
    const volume = parseVolume(data['volume'])
    return str(root) && volume !== null ? { type: 'start', scanId, root, volume } : null
  }
  if (data['type'] === 'cancel') return { type: 'cancel', scanId }
  return null
}

export function createScannerHost(deps: ScannerHostDeps): ScannerHost {
  let current: RunningScan | null = null
  let store: TreeStore | null = null
  let sorter: ChildSorter | null = null
  let sideViews: SideViews | null = null
  let storeScanId: string | null = null
  /** Refreshes run one after another, never during a scan of the same tree. */
  let refreshes: Promise<unknown> = Promise.resolve()
  /** The refresh walking right now; a new scan aborts it so it never outlives its tree. */
  let refreshController: AbortController | null = null

  const run = async (
    scanId: string,
    rootPath: string,
    tree: TreeStore,
    signal: AbortSignal,
  ): Promise<void> => {
    const startedAt = deps.now()
    const totals = () => {
      const { files, folders, bytes, allocatedBytes } = tree.totals()
      return { scanId, files, folders, bytes, allocatedBytes, elapsedMs: deps.now() - startedAt }
    }
    const stopTicker = deps.startTicker(() => {
      const progress: ScanProgress = {
        ...totals(),
        currentPath: tree.currentPath,
        errorCount: tree.errorCount,
      }
      deps.post({ type: 'progress', payload: progress })
    }, SNAPSHOT_INTERVAL_MS)
    let walkers = 1
    try {
      if (deps.walkParallel === undefined) {
        await walk(rootPath, 0, tree, { lister: deps.lister, signal })
      } else {
        try {
          walkers = (await deps.walkParallel(rootPath, 0, tree, signal)).walkers
        } catch (error) {
          // No worker could start, so nothing was walked yet: the single-thread walk takes over.
          if (!(error instanceof WalkerStartupError)) throw error
          walkers = 1
          await walk(rootPath, 0, tree, { lister: deps.lister, signal })
        }
      }
    } finally {
      stopTicker()
    }
    const done: ScanDone = {
      ...totals(),
      status: signal.aborted ? 'canceled' : 'complete',
      errors: [...tree.errors],
      errorCount: tree.errorCount,
      walkers,
    }
    deps.post({ type: 'done', payload: done })
  }

  const refresh = async (
    scanId: string,
    nodeId: string,
  ): Promise<ScannerQueryResults['refresh']> => {
    if (store === null || sorter === null || storeScanId !== scanId) return null
    if (current !== null && current.scanId === scanId) throw new Error(REFRESH_BUSY_MESSAGE)
    // Tree and sorter are captured together, so a superseded refresh never mixes them.
    const tree = store
    const treeSorter = sorter
    const ref = resolveNode(tree, nodeId)
    if (ref === null) return null
    const folder = folderOf(tree, ref)
    if (folder === 0) throw new Error(ROOT_REFRESH_MESSAGE)
    const controller = new AbortController()
    refreshController = controller
    try {
      tree.resetFolder(folder)
      await walk(tree.folderPath(folder), folder, tree, {
        lister: deps.lister,
        signal: controller.signal,
      })
    } finally {
      if (refreshController === controller) refreshController = null
    }
    if (controller.signal.aborted) return null
    return nodeDetails(tree, treeSorter, `d${folder}`, 'size', 'desc')
  }

  const answer = async (query: ScannerQuery): Promise<unknown> => {
    if (query.kind === 'refresh') {
      const next = refreshes.then(() => refresh(query.scanId, query.nodeId))
      refreshes = next.catch(() => undefined)
      return next
    }
    if (store === null || sorter === null || sideViews === null || storeScanId !== query.scanId) {
      return query.kind === 'expand'
        ? []
        : query.kind === 'paths'
          ? query.nodeIds.map(() => null)
          : null
    }
    switch (query.kind) {
      case 'children':
        return childrenPage(
          store,
          sorter,
          query.nodeId,
          query.sortKey,
          query.sortDir,
          query.offset,
          query.limit,
        )
      case 'node':
        return nodeDetails(store, sorter, query.nodeId, query.sortKey, query.sortDir)
      case 'paths':
        return nodePaths(store, query.nodeIds)
      case 'expand':
        return expandIds(store, query.nodeId, query.levels)
      case 'treemap':
        return treemapLayout(
          store,
          query.nodeId,
          query.mode,
          query.depth,
          query.width,
          query.height,
        )
      case 'top-files':
        return sideViews.topFiles(query.nodeId, query.mode)
      case 'types':
        return sideViews.types(query.nodeId)
      case 'age':
        return sideViews.age(query.nodeId)
      case 'totals':
        return store.totals()
    }
  }

  return {
    handle(request) {
      if (request.type === 'query') {
        answer(request.query).then(
          (result) => deps.post({ type: 'reply', requestId: request.requestId, ok: true, result }),
          (error: unknown) =>
            deps.post({
              type: 'reply',
              requestId: request.requestId,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            }),
        )
        return
      }
      if (request.type === 'cancel') {
        if (current?.scanId === request.scanId) current.controller.abort()
        return
      }
      current?.controller.abort() // a new start supersedes the running scan
      refreshController?.abort() // and any refresh still walking the old tree
      // The previous tree is dropped now, so two full trees are never held at once.
      store = new TreeStore(request.root, request.volume.clusterBytes, request.volume.freeBytes)
      sorter = new ChildSorter(store)
      sideViews = new SideViews(store, deps.wallClock)
      storeScanId = request.scanId
      const controller = new AbortController()
      const scan: RunningScan = { scanId: request.scanId, controller, finished: Promise.resolve() }
      current = scan
      scan.finished = run(request.scanId, request.root, store, controller.signal)
        .catch((error: unknown) => {
          deps.post({
            type: 'failed',
            payload: {
              scanId: request.scanId,
              message: error instanceof Error ? error.message : String(error),
            },
          })
        })
        .finally(() => {
          if (current === scan) current = null
        })
    },
    idle: async () => {
      await (current?.finished ?? Promise.resolve())
      await refreshes
    },
    currentStore: () => store,
  }
}
