/** How often a watched item is re-checked, and how long a watch lasts before it gives up. */
export const ITEM_POLL_INTERVAL_MS = 500
export const ITEM_WATCH_TIMEOUT_MS = 15_000

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

  return {
    watch({ key, itemPath, isCurrent, onSettled }) {
      const startedAt = deps.now()
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
        deps.pathExists(itemPath).then(
          (exists) => settle(exists),
          () => settle(true),
        )
      }
      const settle = (exists: boolean): void => {
        if (stopped) return
        if (!exists) {
          stop()
          onSettled('gone')
        } else if (deps.now() - startedAt >= ITEM_WATCH_TIMEOUT_MS) {
          stop()
          onSettled('timeout')
        } else {
          cancelTimer = deps.schedule(poll, ITEM_POLL_INTERVAL_MS)
        }
      }
      poll()
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
