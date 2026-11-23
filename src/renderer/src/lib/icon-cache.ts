import type { IconBatch, IconImage, StorageIQApi } from '@shared/ipc-contract'
import type { NodeId } from '@shared/tree-types'

/** Ids asked for within this window go out as one `getIcons` call. */
export const ICON_BATCH_DELAY_MS = 40
/** A `pending` id (answered with its type’s icon only) is asked again after this long. */
export const ICON_PENDING_DELAY_MS = 500
/** A `pending` id is asked again at most this many times. */
export const MAX_PENDING_RETRIES = 3
/** Ids in one `getIcons` call (main refuses more). */
export const MAX_ICON_IDS_PER_CALL = 64
/** Images kept in the renderer (least recently used go first). */
export const MAX_RENDERER_ICON_IMAGES = 400
/** Rows whose key is remembered; the oldest are forgotten (and may be asked for again). */
const MAX_REMEMBERED_ROWS = 20_000

export interface IconCache {
  /**
   * The ids of the rendered window of rows. Ids not asked for yet are collected for 40 ms and
   * sent as one call (at most 64 per call, one call in flight); a later set replaces an unsent
   * earlier one, because only the latest visible rows matter. A different `scanId` clears
   * everything.
   */
  request(scanId: string | null, nodeIds: readonly NodeId[]): void
  /** The icon key of a row, once main answered. */
  keyOf(nodeId: NodeId): string | undefined
  /** The image of a row (null-safe: undefined until it arrives). Refreshes its recency. */
  imageOf(nodeId: NodeId): IconImage | undefined
  /** Images held now. */
  readonly imageCount: number
  /** Calls `listener` after every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
}

export interface IconCacheDeps {
  getIcons: StorageIQApi['getIcons']
}

/**
 * The renderer side of the row icons: `nodeId → key` for the current scan and
 * `key → IconImage` in an LRU. A plain module (the React side is `useRowIcon`). Native failures
 * never reach it as an error: the rows simply keep their placeholder.
 */
export function createIconCache(deps: IconCacheDeps): IconCache {
  let scanId: string | null = null
  /** Bumped on every scan change, so late answers of an older scan are recognisable. */
  let generation = 0
  const keys = new Map<NodeId, string>()
  /** Ids sent or being sent (never asked twice unless `pending` or evicted). */
  const asked = new Set<NodeId>()
  const images = new Map<string, IconImage>()
  /** Keys whose image was evicted: their rows are asked for again when they are rendered. */
  const evicted = new Set<string>()
  const retries = new Map<NodeId, number>()
  let unsent: NodeId[] = []
  let retryQueue = new Set<NodeId>()
  let inFlight = false
  let batchTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimers = new Set<ReturnType<typeof setTimeout>>()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of [...listeners]) listener()
  }

  const clear = (): void => {
    generation += 1
    keys.clear()
    asked.clear()
    images.clear()
    evicted.clear()
    retries.clear()
    unsent = []
    retryQueue = new Set()
    if (batchTimer !== null) clearTimeout(batchTimer)
    batchTimer = null
    for (const timer of retryTimers) clearTimeout(timer)
    retryTimers = new Set()
  }

  const remember = (key: string, image: IconImage): void => {
    images.delete(key)
    images.set(key, image)
    evicted.delete(key)
    while (images.size > MAX_RENDERER_ICON_IMAGES) {
      const oldest = images.keys().next()
      if (oldest.done) break
      images.delete(oldest.value)
      evicted.add(oldest.value)
    }
  }

  const apply = (batch: IconBatch): void => {
    for (const [key, image] of Object.entries(batch.images)) remember(key, image)
    for (const [id, key] of Object.entries(batch.keys)) {
      keys.delete(id)
      keys.set(id, key)
    }
    while (keys.size > MAX_REMEMBERED_ROWS) {
      const oldest = keys.keys().next()
      if (oldest.done) break
      keys.delete(oldest.value)
      asked.delete(oldest.value)
    }
  }

  const flush = (): void => {
    if (inFlight || scanId === null) return
    const chunk: NodeId[] = []
    for (const id of [...retryQueue, ...unsent]) {
      if (chunk.length >= MAX_ICON_IDS_PER_CALL) break
      if (!chunk.includes(id)) chunk.push(id)
    }
    if (chunk.length === 0) return
    const taken = new Set(chunk)
    unsent = unsent.filter((id) => !taken.has(id))
    for (const id of taken) retryQueue.delete(id)
    for (const id of chunk) asked.add(id)
    inFlight = true
    const sentFor = generation
    const sentScan = scanId
    const done = (batch: IconBatch | null): void => {
      inFlight = false
      if (sentFor === generation && batch !== null) {
        apply(batch)
        notify()
        for (const id of batch.pending) {
          const used = retries.get(id) ?? 0
          if (used >= MAX_PENDING_RETRIES) continue
          retries.set(id, used + 1)
          const timer = setTimeout(() => {
            retryTimers.delete(timer)
            if (sentFor !== generation) return
            retryQueue.add(id)
            schedule()
          }, ICON_PENDING_DELAY_MS)
          retryTimers.add(timer)
        }
      }
      // The next call of a long list, or whatever became visible meanwhile.
      if (sentFor === generation) flush()
      else if (unsent.length > 0 || retryQueue.size > 0) schedule()
    }
    deps.getIcons(sentScan, chunk).then(done, () => done(null))
  }

  const schedule = (): void => {
    if (batchTimer !== null) return
    batchTimer = setTimeout(() => {
      batchTimer = null
      flush()
    }, ICON_BATCH_DELAY_MS)
  }

  return {
    request(nextScanId, nodeIds) {
      if (nextScanId !== scanId) {
        clear()
        scanId = nextScanId
      }
      if (scanId === null) return
      const wanted: NodeId[] = []
      for (const id of nodeIds) {
        const key = keys.get(id)
        if (key !== undefined && evicted.has(key)) asked.delete(id)
        if (!asked.has(id)) wanted.push(id)
      }
      // The latest visible set replaces an unsent earlier one.
      unsent = wanted
      if (wanted.length > 0) schedule()
    },
    keyOf: (nodeId) => keys.get(nodeId),
    imageOf(nodeId) {
      const key = keys.get(nodeId)
      if (key === undefined) return undefined
      const image = images.get(key)
      if (image === undefined) return undefined
      images.delete(key)
      images.set(key, image)
      return image
    },
    get imageCount() {
      return images.size
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
