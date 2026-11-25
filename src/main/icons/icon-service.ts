import type { IconImage } from '@shared/ipc-contract'
import { createIconCache, NEGATIVE_TTL_MS } from './icon-cache'
import { normalizeFolderPath } from './icon-keys'
import {
  ICON_IDLE_MS,
  ICON_LOAD_TIMEOUT_MS,
  ICON_MAX_ITEMS_PER_MESSAGE,
  ICON_QUEUE_MAX,
  ICON_WORKER_TIMEOUT_MS,
  type IconWorkerReply,
  type IconWorkerRequest,
  type IconWorkItem,
} from './icon-worker-protocol'

export { ICON_IDLE_MS, ICON_LOAD_TIMEOUT_MS, ICON_QUEUE_MAX, ICON_WORKER_TIMEOUT_MS }

/** The part of a `worker_threads` Worker the service uses; tests pass a fake. */
export interface IconWorkerLike {
  postMessage(message: IconWorkerRequest): void
  on(event: 'message', listener: (message: IconWorkerReply) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  terminate(): Promise<number>
}

const isPathKey = (key: string): boolean => key.startsWith('f:') || key.startsWith('drive:')

export interface IconServiceDeps {
  spawn(): IconWorkerLike
  /** Runs `callback` once after `ms`; returns a function that cancels it. */
  schedule(callback: () => void, ms: number): () => void
  now(): number
  /** Images kept in memory (512). */
  maxEntries: number
  /** Negative entries kept (4096). */
  maxPathKeys: number
}

export interface IconRequestResult {
  /** Every requested key that could be produced. */
  images: Record<string, IconImage>
  /** Requested keys that have no image (not found, worker busy, timed out, disposed). */
  missing: string[]
  /** Missing keys the worker skipped for its time budget (worth asking again soon). */
  skipped: string[]
}

export interface IconService {
  /**
   * Icons for `targets`. A cached key is answered without the worker, a key already being looked
   * up is shared, and the rest goes to the worker in messages of at most 64 items. It never
   * rejects: any native failure answers with the keys under `missing`.
   */
  request(targets: readonly IconWorkItem[]): Promise<IconRequestResult>
  /** Lower-cased paths of the known folders (asked once; empty if the worker cannot answer). */
  knownFolders(): Promise<ReadonlySet<string>>
  /** A new scan: per-file icons may have changed, so only `f:` keys are dropped. */
  newScan(): void
  /** Quit: ends the worker and answers everything pending empty. */
  dispose(): void
}

interface Job {
  build(id: number): IconWorkerRequest
  /** `null`: no answer (timeout, crash, dropped, disposed). */
  /** `lost`: the worker timed out or died while serving this job (not dropped or disposed). */
  finish(reply: IconWorkerReply | null, lost?: boolean): void
}

interface Slot {
  worker: IconWorkerLike
  /** The worker said koffi is loaded; only then may it be terminated. */
  ready: boolean
  dead: boolean
}

/**
 * Serves icons from one lazily started icon worker thread (the shell calls behind an icon can
 * block for seconds, so they never run on the main thread or in the shell worker pool).
 * One request is in flight at a time; up to `ICON_QUEUE_MAX` wait, the oldest is dropped when
 * more arrive. A request not answered within `ICON_WORKER_TIMEOUT_MS` discards the worker (a new
 * one starts for the next request); an idle worker ends after `ICON_IDLE_MS`. A worker that has
 * not reported `ready` is still inside koffi's native module load: terminating it there aborts
 * the process, so it is only asked to exit once it has loaded.
 */
export function createIconService(deps: IconServiceDeps): IconService {
  const cache = createIconCache(deps.maxEntries, deps.maxPathKeys)
  const inflight = new Map<string, Promise<IconImage | 'skipped' | null>>()
  const queue: Job[] = []
  let slot: Slot | null = null
  let current: { job: Job; id: number; cancelTimeout: () => void } | null = null
  let cancelIdle: (() => void) | null = null
  let nextId = 1
  let disposed = false
  let known: { set: ReadonlySet<string>; until: number } | null = null
  let knownPending: Promise<ReadonlySet<string>> | null = null

  const discard = (target: Slot): void => {
    if (target.dead) return
    target.dead = true
    if (slot === target) slot = null
    if (target.ready) target.worker.terminate().catch(() => undefined)
    else {
      try {
        target.worker.postMessage({ type: 'exit' })
      } catch {
        // the thread is already gone
      }
    }
  }

  const spawnSlot = (): Slot => {
    const worker = deps.spawn()
    const created: Slot = { worker, ready: false, dead: false }
    worker.on('message', (reply) => {
      if (created.dead) return
      if (reply.type === 'ready') {
        created.ready = true
        // The request clock starts now: koffi's cold load is not the request's fault.
        if (current !== null && slot === created) {
          current.cancelTimeout()
          current.cancelTimeout = deps.schedule(timedOut, ICON_WORKER_TIMEOUT_MS)
        }
        return
      }
      if (current === null || current.id !== reply.id) return
      completeCurrent(reply)
    })
    const died = (): void => {
      if (created.dead) return
      discard(created)
      if (current !== null) completeCurrent(null, true)
    }
    worker.on('error', died)
    worker.on('exit', died)
    return created
  }

  const completeCurrent = (reply: IconWorkerReply | null, lost = false): void => {
    const running = current
    if (running === null) return
    current = null
    running.cancelTimeout()
    running.job.finish(reply?.type === 'failed' ? null : reply, lost || reply?.type === 'failed')
    pump()
  }

  const timedOut = (): void => {
    const running = current
    if (running === null) return
    if (slot !== null) discard(slot)
    completeCurrent(null, true)
  }

  const pump = (): void => {
    if (current !== null || disposed) return
    const job = queue.shift()
    if (job === undefined) {
      if (slot !== null && cancelIdle === null) {
        const idle = slot
        cancelIdle = deps.schedule(() => {
          cancelIdle = null
          if (current === null && slot === idle) discard(idle)
        }, ICON_IDLE_MS)
      }
      return
    }
    cancelIdle?.()
    cancelIdle = null
    const id = nextId
    nextId += 1
    try {
      slot ??= spawnSlot()
      const started = slot
      current = {
        job,
        id,
        // Before `ready` only the (longer) load deadline runs; `ready` restarts the request clock.
        cancelTimeout: deps.schedule(
          timedOut,
          started.ready ? ICON_WORKER_TIMEOUT_MS : ICON_LOAD_TIMEOUT_MS,
        ),
      }
      slot.worker.postMessage(job.build(id))
    } catch {
      if (slot !== null) discard(slot)
      if (current === null) job.finish(null)
      else completeCurrent(null)
    }
  }

  const enqueue = (job: Job): void => {
    if (disposed) {
      job.finish(null)
      return
    }
    queue.push(job)
    while (queue.length > ICON_QUEUE_MAX) queue.shift()?.finish(null)
    pump()
  }

  /** Sends `items` and settles each key's promise from the answer. */
  const lookup = (
    items: IconWorkItem[],
    settle: Map<string, (image: IconImage | 'skipped' | null) => void>,
    negativeOnLoss: boolean,
  ): void => {
    enqueue({
      build: (id) => ({ type: 'get', id, items }),
      finish: (reply, lost) => {
        const results = new Map(
          reply?.type === 'icons' ? reply.results.map((result) => [result.key, result]) : [],
        )
        for (const { key } of items) {
          const result = results.get(key)
          let image: IconImage | 'skipped' | null = null
          if (result?.image) {
            image = result.image
            cache.set(key, image)
          } else if (result?.skipped === true) {
            image = 'skipped'
          } else if (result !== undefined) {
            // Windows had no icon for it: do not ask again for a minute.
            cache.setMissing(key, deps.now())
          } else if (lost === true && negativeOnLoss && isPathKey(key)) {
            // A hung or crashed lookup: a path that blocks must not be retried on every scroll.
            cache.setMissing(key, deps.now())
          }
          settle.get(key)?.(image)
          inflight.delete(key)
        }
      },
    })
  }

  return {
    async request(targets) {
      const images: Record<string, IconImage> = {}
      const missing: string[] = []
      const skipped: string[] = []
      const waits: Array<Promise<void>> = []
      const toSend: IconWorkItem[] = []
      const settle = new Map<string, (image: IconImage | 'skipped' | null) => void>()
      const seen = new Set<string>()
      const record = (key: string, promise: Promise<IconImage | 'skipped' | null>): void => {
        waits.push(
          promise.then((image) => {
            if (image === 'skipped') {
              missing.push(key)
              skipped.push(key)
            } else if (image === null) missing.push(key)
            else images[key] = image
          }),
        )
      }
      for (const item of targets) {
        if (seen.has(item.key)) continue
        seen.add(item.key)
        const cached = cache.get(item.key)
        if (cached !== undefined) images[item.key] = cached
        else if (disposed || cache.isMissing(item.key, deps.now())) missing.push(item.key)
        else {
          const pending = inflight.get(item.key)
          if (pending !== undefined) record(item.key, pending)
          else {
            const promise = new Promise<IconImage | 'skipped' | null>((resolve) =>
              settle.set(item.key, resolve),
            )
            inflight.set(item.key, promise)
            toSend.push(item)
            record(item.key, promise)
          }
        }
      }
      // Cheap type lookups go first and in their own messages: a per-file call that hangs on a
      // dead share must not take the type icons of the same request down with it.
      for (const group of [
        toSend.filter((item) => item.target.kind !== 'path'),
        toSend.filter((item) => item.target.kind === 'path'),
      ]) {
        for (let i = 0; i < group.length; i += ICON_MAX_ITEMS_PER_MESSAGE) {
          lookup(group.slice(i, i + ICON_MAX_ITEMS_PER_MESSAGE), settle, true)
        }
      }
      await Promise.all(waits)
      return { images, missing, skipped }
    },

    knownFolders() {
      if (known !== null && known.until > deps.now()) return Promise.resolve(known.set)
      if (disposed) return Promise.resolve(new Set<string>())
      if (knownPending !== null) return knownPending
      let settled = false
      const promise = new Promise<ReadonlySet<string>>((resolve) => {
        enqueue({
          build: (id) => ({ type: 'known-folders', id }),
          finish: (reply) => {
            settled = true
            knownPending = null
            if (reply?.type === 'known-folders') {
              const set = new Set(reply.paths.map(normalizeFolderPath))
              known = { set, until: Number.POSITIVE_INFINITY }
              resolve(set)
            } else {
              // Try again later, not on every call.
              const set = new Set<string>()
              known = { set, until: deps.now() + NEGATIVE_TTL_MS }
              resolve(set)
            }
          },
        })
      })
      if (!settled) knownPending = promise
      return promise
    },

    newScan() {
      cache.clearPrefix('f:')
    },

    dispose() {
      if (disposed) return
      disposed = true
      cancelIdle?.()
      cancelIdle = null
      if (slot !== null) discard(slot)
      if (current !== null) completeCurrent(null)
      for (const job of queue.splice(0)) job.finish(null)
    },
  }
}
