import { mapLimit } from './map-limit'

/** How often a watched item is re-checked, and how long a watch lasts before it gives up. */
export const ITEM_POLL_INTERVAL_MS = 500
export const ITEM_WATCH_TIMEOUT_MS = 15_000
/** Most paths checked at the same time by one tick of `watchMany`. */
export const ITEM_CHECKS_IN_FLIGHT = 16
/** Most paths one `watchMany` accepts. */
export const MAX_WATCHED_ITEMS = 1000

export interface ItemWatcherDeps {
  pathExists(target: string): Promise<boolean>
  /** Runs `callback` once after `ms`; returns a function that cancels it. */
  schedule(callback: () => void, ms: number): () => void
  now(): number
}

export interface ItemWatcher {
  /**
   * Polls until `itemPath` no longer exists (`'gone'`) or the timeout passes (`'timeout'`), then
   * calls `onSettled` once. A watch whose `isCurrent()` turns false stops silently, and a second
   * watch with the same `key` replaces the first.
   */
  watch(request: {
    key: string
    itemPath: string
    isCurrent(): boolean
    onSettled(reason: 'gone' | 'timeout'): void
  }): void
  /**
   * Like `watch` for many paths (at most 1,000, else `RangeError`): each tick re-checks the paths
   * still present, with at most 16 `pathExists` calls in flight. Settles `'gone'` when none
   * remain, or `'timeout'` with the paths that are still there.
   */
  watchMany(request: {
    key: string
    itemPaths: readonly string[]
    isCurrent(): boolean
    onSettled(reason: 'gone' | 'timeout', remaining: readonly string[]): void
  }): void
  /** A cancellable one-shot timer; `run` is skipped when `isCurrent()` is false by then. */
  later(request: { key: string; isCurrent(): boolean; run(): void; ms: number }): void
  cancelAll(): void
  readonly active: number
}

export function createItemWatcher(deps: ItemWatcherDeps): ItemWatcher {
  /** Every live watch and delayed callback, by key, with the function that cancels it. */
  const live = new Map<string, () => void>()

  const register = (key: string, cancel: () => void): void => {
    live.get(key)?.()
    live.set(key, cancel)
  }

  const watchMany: ItemWatcher['watchMany'] = ({ key, itemPaths, isCurrent, onSettled }) => {
    if (itemPaths.length > MAX_WATCHED_ITEMS) {
      throw new RangeError(`at most ${MAX_WATCHED_ITEMS} paths can be watched`)
    }
    const startedAt = deps.now()
    let remaining: readonly string[] = [...itemPaths]
    let cancelTimer: (() => void) | null = null
    let stopped = false
    const stop = (): void => {
      stopped = true
      cancelTimer?.()
      cancelTimer = null
      if (live.get(key) === stop) live.delete(key)
    }
    register(key, stop)

    const poll = (): void => {
      cancelTimer = null
      if (stopped) return
      if (!isCurrent()) {
        stop()
        return
      }
      const checked = remaining
      void mapLimit(checked, ITEM_CHECKS_IN_FLIGHT, (target) =>
        deps.pathExists(target).then(
          (exists) => exists,
          () => true,
        ),
      ).then((present) => settle(checked.filter((_, index) => present[index] === true)))
    }
    const settle = (stillThere: readonly string[]): void => {
      if (stopped) return
      if (!isCurrent()) {
        stop()
        return
      }
      remaining = stillThere
      if (stillThere.length === 0) {
        stop()
        onSettled('gone', [])
      } else if (deps.now() - startedAt >= ITEM_WATCH_TIMEOUT_MS) {
        stop()
        onSettled('timeout', stillThere)
      } else {
        cancelTimer = deps.schedule(poll, ITEM_POLL_INTERVAL_MS)
      }
    }
    poll()
  }

  return {
    watchMany,
    watch({ key, itemPath, isCurrent, onSettled }) {
      watchMany({
        key,
        itemPaths: [itemPath],
        isCurrent,
        onSettled: (reason) => onSettled(reason),
      })
    },

    later({ key, isCurrent, run, ms }) {
      const cancel = deps.schedule(() => {
        if (live.get(key) === cancel) live.delete(key)
        if (isCurrent()) run()
      }, ms)
      register(key, cancel)
    },

    cancelAll() {
      for (const cancel of [...live.values()]) cancel()
      live.clear()
    },

    get active() {
      return live.size
    },
  }
}
