import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createItemWatcher,
  ITEM_POLL_INTERVAL_MS,
  ITEM_WATCH_TIMEOUT_MS,
  type ItemWatcher,
} from './item-watcher'

function setup(pathExists: (target: string) => Promise<boolean>) {
  const watcher: ItemWatcher = createItemWatcher({
    pathExists,
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
    now: () => Date.now(),
  })
  return watcher
}

function sequence(...answers: boolean[]) {
  const fn = vi.fn(async () => answers.shift() ?? answers.at(-1) ?? true)
  return fn
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('item watcher', () => {
  it('settles with gone the first time the item is missing', async () => {
    const answers = [true, true, false]
    const pathExists = vi.fn(async () => answers.shift() ?? false)
    const watcher = setup(pathExists)
    const onSettled = vi.fn()
    watcher.watch({ key: 'k', itemPath: 'D:/a', isCurrent: () => true, onSettled })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(onSettled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith('gone')
    expect(watcher.active).toBe(0)
  })

  it('settles with timeout when the item never goes away', async () => {
    const watcher = setup(async () => true)
    const onSettled = vi.fn()
    watcher.watch({ key: 'k', itemPath: 'D:/a', isCurrent: () => true, onSettled })
    await vi.advanceTimersByTimeAsync(ITEM_WATCH_TIMEOUT_MS)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith('timeout')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(watcher.active).toBe(0)
  })

  it('polls every 500 ms and no faster', async () => {
    const pathExists = sequence(true)
    const watcher = setup(pathExists)
    watcher.watch({ key: 'k', itemPath: 'D:/a', isCurrent: () => true, onSettled: vi.fn() })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(ITEM_POLL_INTERVAL_MS).toBe(500)
    expect(pathExists).toHaveBeenCalledTimes(5)
  })

  it('cancels silently when isCurrent turns false', async () => {
    const pathExists = sequence(true)
    const watcher = setup(pathExists)
    let current = true
    const onSettled = vi.fn()
    watcher.watch({ key: 'k', itemPath: 'D:/a', isCurrent: () => current, onSettled })
    await vi.advanceTimersByTimeAsync(1_000)
    current = false
    const calls = pathExists.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(onSettled).not.toHaveBeenCalled()
    expect(pathExists).toHaveBeenCalledTimes(calls)
    expect(watcher.active).toBe(0)
  })

  it('stays silent when the scan turns non-current while pathExists is in flight', async () => {
    let answer: (exists: boolean) => void = () => undefined
    const pathExists = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve
        }),
    )
    const watcher = setup(pathExists)
    let current = true
    const onSettled = vi.fn()
    watcher.watch({ key: 'k', itemPath: 'D:/a', isCurrent: () => current, onSettled })
    await vi.advanceTimersByTimeAsync(0)
    expect(pathExists).toHaveBeenCalledTimes(1)
    current = false
    answer(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(onSettled).not.toHaveBeenCalled()
    expect(watcher.active).toBe(0)
  })

  it('replaces a watch with the same key', async () => {
    const watcher = setup(async () => true)
    const first = vi.fn()
    const second = vi.fn()
    watcher.watch({ key: 'k', itemPath: 'D:/a', isCurrent: () => true, onSettled: first })
    watcher.watch({ key: 'k', itemPath: 'D:/a', isCurrent: () => true, onSettled: second })
    expect(watcher.active).toBe(1)
    await vi.advanceTimersByTimeAsync(ITEM_WATCH_TIMEOUT_MS)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('cancelAll stops every watch and every later callback', async () => {
    const pathExists = sequence(true)
    const watcher = setup(pathExists)
    const onSettled = vi.fn()
    const run = vi.fn()
    watcher.watch({ key: 'a', itemPath: 'D:/a', isCurrent: () => true, onSettled })
    watcher.watch({ key: 'b', itemPath: 'D:/b', isCurrent: () => true, onSettled })
    watcher.later({ key: 'c', isCurrent: () => true, run, ms: 1_500 })
    await vi.advanceTimersByTimeAsync(0)
    const calls = pathExists.mock.calls.length
    watcher.cancelAll()
    expect(watcher.active).toBe(0)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(onSettled).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(pathExists).toHaveBeenCalledTimes(calls)
    expect(watcher.active).toBe(0)
  })

  it('treats a failing pathExists as present', async () => {
    const watcher = setup(async () => {
      throw new Error('boom')
    })
    const onSettled = vi.fn()
    watcher.watch({ key: 'k', itemPath: 'D:/a', isCurrent: () => true, onSettled })
    await vi.advanceTimersByTimeAsync(ITEM_WATCH_TIMEOUT_MS)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith('timeout')
  })

  it('later runs once and honours isCurrent', async () => {
    const watcher = setup(async () => true)
    const run = vi.fn()
    watcher.later({ key: 'a', isCurrent: () => true, run, ms: 1_500 })
    await vi.advanceTimersByTimeAsync(1_499)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(run).toHaveBeenCalledTimes(1)

    const skipped = vi.fn()
    watcher.later({ key: 'b', isCurrent: () => false, run: skipped, ms: 1_500 })
    await vi.advanceTimersByTimeAsync(2_000)
    expect(skipped).not.toHaveBeenCalled()
    expect(watcher.active).toBe(0)
  })
})

describe('watchMany', () => {
  it('watchMany settles gone when every path is gone', async () => {
    const present = new Set(['D:/a', 'D:/b'])
    const pathExists = vi.fn(async (target: string) => present.has(target))
    const watcher = setup(pathExists)
    const onSettled = vi.fn()
    watcher.watchMany({
      key: 'k',
      itemPaths: ['D:/a', 'D:/b'],
      isCurrent: () => true,
      onSettled,
    })
    await vi.advanceTimersByTimeAsync(0)
    present.delete('D:/a')
    await vi.advanceTimersByTimeAsync(ITEM_POLL_INTERVAL_MS)
    expect(onSettled).not.toHaveBeenCalled()
    present.delete('D:/b')
    await vi.advanceTimersByTimeAsync(ITEM_POLL_INTERVAL_MS)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith('gone', [])
    expect(watcher.active).toBe(0)
  })

  it('watchMany reports the remaining paths on timeout', async () => {
    const pathExists = vi.fn(async (target: string) => target === 'D:/stays')
    const watcher = setup(pathExists)
    const onSettled = vi.fn()
    watcher.watchMany({
      key: 'k',
      itemPaths: ['D:/stays', 'D:/goes'],
      isCurrent: () => true,
      onSettled,
    })
    await vi.advanceTimersByTimeAsync(ITEM_WATCH_TIMEOUT_MS)
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith('timeout', ['D:/stays'])
  })

  it('watchMany checks at most 16 paths at a time', async () => {
    let inFlight = 0
    let peak = 0
    const pathExists = vi.fn(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight -= 1
      return true
    })
    const watcher = setup(pathExists)
    watcher.watchMany({
      key: 'k',
      itemPaths: Array.from({ length: 100 }, (_, i) => `D:/f${i}`),
      isCurrent: () => true,
      onSettled: vi.fn(),
    })
    await vi.advanceTimersByTimeAsync(200)
    expect(peak).toBe(16)
    expect(pathExists.mock.calls.length).toBeGreaterThanOrEqual(100)
    watcher.cancelAll()
  })

  it('watchMany refuses more than 1000 paths', () => {
    const watcher = setup(async () => true)
    expect(() =>
      watcher.watchMany({
        key: 'k',
        itemPaths: Array.from({ length: 1001 }, (_, i) => `D:/f${i}`),
        isCurrent: () => true,
        onSettled: vi.fn(),
      }),
    ).toThrow(RangeError)
    expect(watcher.active).toBe(0)
  })

  it('watch still behaves as before', async () => {
    const pathExists = vi.fn(async () => false)
    const watcher = setup(pathExists)
    const onSettled = vi.fn()
    watcher.watch({ key: 'k', itemPath: 'D:/a', isCurrent: () => true, onSettled })
    await vi.advanceTimersByTimeAsync(0)
    expect(onSettled).toHaveBeenCalledWith('gone')
  })
})
