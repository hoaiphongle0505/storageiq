import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IconBatch, IconImage } from '@shared/ipc-contract'
import {
  createIconCache,
  ICON_BATCH_DELAY_MS,
  ICON_PENDING_DELAY_MS,
  MAX_ICON_IDS_PER_CALL,
  MAX_RENDERER_ICON_IMAGES,
} from './icon-cache'

const image = (tag: string): IconImage => ({ small: `s-${tag}`, large: `l-${tag}` })
const ids = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `f${from + i}`)

/** A getIcons that answers `ext:txt` for every id (or whatever `answer` says). */
function setup(answer?: (scanId: string, ids: string[]) => IconBatch) {
  const calls: Array<{ scanId: string; ids: string[] }> = []
  const resolvers: Array<() => void> = []
  const getIcons = vi.fn(async (scanId: string, requested: string[]): Promise<IconBatch> => {
    calls.push({ scanId, ids: [...requested] })
    if (answer) return answer(scanId, requested)
    return {
      keys: Object.fromEntries(requested.map((id) => [id, 'ext:txt'])),
      images: { 'ext:txt': image('txt') },
      pending: [],
    }
  })
  const cache = createIconCache({ getIcons })
  return { cache, calls, getIcons, resolvers }
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the renderer icon cache', () => {
  it('collects ids for 40 ms and sends one batch', async () => {
    const { cache, calls } = setup()
    expect(ICON_BATCH_DELAY_MS).toBe(40)
    cache.request('scan-1', ['f1', 'f2'])
    vi.advanceTimersByTime(20)
    cache.request('scan-1', ['f1', 'f2', 'f3'])
    expect(calls).toHaveLength(0)
    vi.advanceTimersByTime(20)
    await flush()
    expect(calls).toEqual([{ scanId: 'scan-1', ids: ['f1', 'f2', 'f3'] }])
    expect(cache.keyOf('f2')).toBe('ext:txt')
    expect(cache.imageOf('f2')).toEqual(image('txt'))
  })

  it('splits more than 64 ids into sequential calls', async () => {
    const { cache, calls } = setup()
    expect(MAX_ICON_IDS_PER_CALL).toBe(64)
    cache.request('scan-1', ids(1, 150))
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    expect(calls.map((call) => call.ids.length)).toEqual([64, 64, 22])
    expect(calls[0]!.ids[0]).toBe('f1')
    expect(calls[2]!.ids.at(-1)).toBe('f150')
  })

  it('sends one call at a time', async () => {
    let release: (batch: IconBatch) => void = () => undefined
    const getIcons = vi.fn(
      () =>
        new Promise<IconBatch>((resolve) => {
          release = resolve
        }),
    )
    const cache = createIconCache({ getIcons })
    cache.request('scan-1', ids(1, 100))
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    expect(getIcons).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1_000)
    await flush()
    expect(getIcons).toHaveBeenCalledTimes(1)
    release({ keys: {}, images: {}, pending: [] })
    await flush()
    expect(getIcons).toHaveBeenCalledTimes(2)
  })

  it('never requests an id twice', async () => {
    const { cache, calls } = setup()
    cache.request('scan-1', ['f1', 'f2'])
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    cache.request('scan-1', ['f1', 'f2', 'f3'])
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    cache.request('scan-1', ['f1', 'f2', 'f3'])
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    expect(calls.map((call) => call.ids)).toEqual([['f1', 'f2'], ['f3']])
  })

  it('a later visible set replaces an unsent earlier one', async () => {
    const { cache, calls } = setup()
    cache.request('scan-1', ids(1, 10))
    vi.advanceTimersByTime(10)
    cache.request('scan-1', ids(500, 505)) // scrolled far away before anything was sent
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    expect(calls.map((call) => call.ids)).toEqual([ids(500, 505)])
    // The first set was never sent, so it can still be asked for when it is visible again.
    cache.request('scan-1', ids(1, 3))
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    expect(calls[1]!.ids).toEqual(ids(1, 3))
  })

  it('pending ids are asked again after 500 ms, at most 3 times', async () => {
    const { cache, calls } = setup((_scan, requested) => ({
      keys: Object.fromEntries(requested.map((id) => [id, 'ext:exe'])),
      images: { 'ext:exe': image('exe') },
      pending: requested,
    }))
    expect(ICON_PENDING_DELAY_MS).toBe(500)
    cache.request('scan-1', ['f1'])
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(ICON_PENDING_DELAY_MS - 1)
    await flush()
    expect(calls).toHaveLength(1)
    for (let round = 0; round < 6; round += 1) {
      vi.advanceTimersByTime(ICON_PENDING_DELAY_MS + ICON_BATCH_DELAY_MS)
      await flush()
    }
    expect(calls).toHaveLength(4) // the first ask and three more
    expect(calls.every((call) => call.ids.length === 1 && call.ids[0] === 'f1')).toBe(true)
  })

  it('a result for an old scan id is ignored', async () => {
    let release: (batch: IconBatch) => void = () => undefined
    const getIcons = vi.fn(
      () =>
        new Promise<IconBatch>((resolve) => {
          release = resolve
        }),
    )
    const cache = createIconCache({ getIcons })
    cache.request('scan-1', ['f1'])
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    cache.request('scan-2', ['f9']) // a new scan: everything is cleared
    release({ keys: { f1: 'ext:txt' }, images: { 'ext:txt': image('txt') }, pending: ['f1'] })
    await flush()
    expect(cache.keyOf('f1')).toBeUndefined()
    expect(cache.imageOf('f1')).toBeUndefined()
    vi.advanceTimersByTime(5_000)
    await flush()
    const asked = (getIcons.mock.calls as unknown as Array<[string, string[]]>).filter(([, ids]) =>
      ids.includes('f1'),
    )
    expect(asked).toHaveLength(1)
  })

  it('the image cache evicts the least recently used past 400', async () => {
    expect(MAX_RENDERER_ICON_IMAGES).toBe(400)
    const { cache } = setup((_scan, requested) => ({
      keys: Object.fromEntries(requested.map((id) => [id, `k:${id}`])),
      images: Object.fromEntries(requested.map((id) => [`k:${id}`, image(id)])),
      pending: [],
    }))
    for (let from = 1; from <= 450; from += 50) {
      cache.request('scan-1', ids(from, from + 49))
      vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
      await flush()
    }
    // 450 images were produced; the cap keeps the 400 most recent.
    expect(cache.imageCount).toBe(400)
    expect(cache.imageOf('f1')).toBeUndefined() // the oldest are gone (the row keeps its key)
    expect(cache.keyOf('f1')).toBe('k:f1')
    expect(cache.imageOf('f450')).toEqual(image('f450'))
  })

  it('tells subscribers when images arrive and lets them unsubscribe', async () => {
    const { cache } = setup()
    const listener = vi.fn()
    const stop = cache.subscribe(listener)
    cache.request('scan-1', ['f1'])
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    expect(listener).toHaveBeenCalled()
    listener.mockClear()
    stop()
    cache.request('scan-1', ['f2'])
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    expect(listener).not.toHaveBeenCalled()
  })

  it('a failing call is swallowed and the placeholders stay', async () => {
    const getIcons = vi.fn().mockRejectedValue(new Error('main said no'))
    const cache = createIconCache({ getIcons })
    cache.request('scan-1', ['f1'])
    vi.advanceTimersByTime(ICON_BATCH_DELAY_MS)
    await flush()
    expect(cache.imageOf('f1')).toBeUndefined()
  })
})
