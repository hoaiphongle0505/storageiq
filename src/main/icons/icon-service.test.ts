import { describe, expect, it } from 'vitest'
import type { IconImage } from '@shared/ipc-contract'
import type { NativeTarget } from './icon-keys'
import type { IconWorkerReply, IconWorkerRequest } from './icon-worker-protocol'
import {
  createIconService,
  ICON_IDLE_MS,
  ICON_LOAD_TIMEOUT_MS,
  ICON_QUEUE_MAX,
  ICON_WORKER_TIMEOUT_MS,
  type IconWorkerLike,
} from './icon-service'
import { NEGATIVE_TTL_MS } from './icon-cache'

const IMAGE: IconImage = {
  small: 'data:image/png;base64,AAAA',
  large: 'data:image/png;base64,BBBB',
}
const SIZE = { small: 16, large: 32 }
const EXT: NativeTarget = { kind: 'file', ext: 'txt' }

class FakeWorker implements IconWorkerLike {
  readonly posted: IconWorkerRequest[] = []
  terminated = 0
  exitMessages = 0
  private message: Array<(reply: IconWorkerReply) => void> = []
  private error: Array<(error: Error) => void> = []
  private exit: Array<(code: number) => void> = []

  postMessage(message: IconWorkerRequest): void {
    if (message.type === 'exit') {
      this.exitMessages += 1
      return
    }
    this.posted.push(message)
  }
  on(event: 'message' | 'error' | 'exit', listener: never): void {
    if (event === 'message') this.message.push(listener)
    else if (event === 'error') this.error.push(listener)
    else this.exit.push(listener)
  }
  terminate(): Promise<number> {
    this.terminated += 1
    return Promise.resolve(1)
  }

  ready(): void {
    for (const listener of this.message) listener({ type: 'ready' })
  }
  /** Answers the nth posted request with an image for every item (or `null` for keys in `nullKeys`). */
  answer(index = this.posted.length - 1, nullKeys: string[] = [], skipped: string[] = []): void {
    const request = this.posted[index]
    if (request?.type !== 'get') throw new Error('not a get request')
    const reply: IconWorkerReply = {
      type: 'icons',
      id: request.id,
      ms: 1,
      results: request.items.map((item) => {
        const none = nullKeys.includes(item.key) || skipped.includes(item.key)
        return {
          key: item.key,
          image: none ? null : IMAGE,
          size: none ? null : SIZE,
          ...(skipped.includes(item.key) ? { skipped: true } : {}),
        }
      }),
    }
    for (const listener of this.message) listener(reply)
  }
  answerKnown(paths: string[]): void {
    const request = this.posted.at(-1)
    if (request?.type !== 'known-folders') throw new Error('not a known-folders request')
    for (const listener of this.message) listener({ type: 'known-folders', id: request.id, paths })
  }
  crash(): void {
    for (const listener of this.exit) listener(1)
  }
  fail(): void {
    for (const listener of this.error) listener(new Error('boom'))
  }
  items(index: number): string[] {
    const request = this.posted[index]
    return request?.type === 'get' ? request.items.map((item) => item.key) : []
  }
}

function setup(readyOnSpawn = true) {
  let clock = 0
  const workers: FakeWorker[] = []
  const timers: Array<{ at: number; callback: () => void; cancelled: boolean }> = []
  const service = createIconService({
    spawn: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      if (readyOnSpawn) queueMicrotask(() => worker.ready())
      return worker
    },
    schedule: (callback, ms) => {
      const timer = { at: clock + ms, callback, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    now: () => clock,
    maxEntries: 512,
    maxPathKeys: 4096,
  })
  const advance = (ms: number) => {
    const end = clock + ms
    for (;;) {
      const due = timers
        .filter((timer) => !timer.cancelled && timer.at <= end)
        .sort((a, b) => a.at - b.at)[0]
      if (!due) break
      due.cancelled = true
      clock = due.at
      due.callback()
    }
    clock = end
  }
  /** Lets promise callbacks run. */
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
  }
  return { service, workers, advance, flush }
}

const target = (key: string, t: NativeTarget = EXT) => ({ key, target: t })

describe('createIconService', () => {
  it('a cached key is answered without the worker', async () => {
    const { service, workers, flush } = setup()
    const first = service.request([target('ext:txt')])
    await flush()
    workers[0]!.answer()
    await expect(first).resolves.toEqual({ images: { 'ext:txt': IMAGE }, skipped: [], missing: [] })
    await expect(service.request([target('ext:txt')])).resolves.toEqual({
      images: { 'ext:txt': IMAGE },
      skipped: [],
      missing: [],
    })
    expect(workers).toHaveLength(1)
    expect(workers[0]!.posted).toHaveLength(1)
  })

  it('two concurrent requests for the same key send one native lookup', async () => {
    const { service, workers, flush } = setup()
    const a = service.request([target('ext:txt')])
    const b = service.request([target('ext:txt'), target('dir', { kind: 'dir' })])
    await flush()
    // One lookup at a time: the first message carries ext:txt, the second (sent once the first
    // is answered) only the key the first did not cover.
    expect(workers[0]!.posted).toHaveLength(1)
    expect(workers[0]!.items(0)).toEqual(['ext:txt'])
    workers[0]!.answer(0)
    await flush()
    expect(workers[0]!.posted).toHaveLength(2)
    expect(workers[0]!.items(1)).toEqual(['dir'])
    workers[0]!.answer(1)
    await expect(a).resolves.toMatchObject({ images: { 'ext:txt': IMAGE } })
    await expect(b).resolves.toMatchObject({ images: { 'ext:txt': IMAGE, dir: IMAGE } })
  })

  it('one worker message carries every missing key of a call and at most 64 items', async () => {
    const { service, workers, flush } = setup()
    void service.request(['a', 'b', 'c'].map((key) => target(`ext:${key}`)))
    await flush()
    expect(workers[0]!.posted).toHaveLength(1)
    expect(workers[0]!.items(0)).toEqual(['ext:a', 'ext:b', 'ext:c'])
    workers[0]!.answer(0)
    await flush()

    const many = Array.from({ length: 100 }, (_, i) => target(`ext:k${i}`))
    void service.request(many)
    await flush()
    workers[0]!.answer(1)
    await flush()
    workers[0]!.answer(2)
    await flush()
    expect(workers[0]!.items(1)).toHaveLength(64)
    expect(workers[0]!.items(2)).toHaveLength(36)
  })

  it('a null result is cached negatively and retried after 60 seconds', async () => {
    const { service, workers, advance, flush } = setup()
    const first = service.request([target('f:0123456789ab', { kind: 'path', path: 'C:\\a.exe' })])
    await flush()
    workers[0]!.answer(0, ['f:0123456789ab'])
    await expect(first).resolves.toEqual({ images: {}, skipped: [], missing: ['f:0123456789ab'] })
    const second = await service.request([
      target('f:0123456789ab', { kind: 'path', path: 'C:\\a.exe' }),
    ])
    expect(second.missing).toEqual(['f:0123456789ab'])
    expect(workers[0]!.posted).toHaveLength(1)
    advance(NEGATIVE_TTL_MS) // the idle worker ends meanwhile, so the retry starts a new one
    void service.request([target('f:0123456789ab', { kind: 'path', path: 'C:\\a.exe' })])
    await flush()
    expect(workers.flatMap((worker) => worker.posted)).toHaveLength(2)
  })

  it('an item the worker skipped for its time budget is not cached negatively', async () => {
    const { service, workers, flush } = setup()
    const first = service.request([target('f:0123456789ab', { kind: 'path', path: 'C:\\a.exe' })])
    await flush()
    workers[0]!.answer(0, [], ['f:0123456789ab'])
    await expect(first).resolves.toEqual({
      images: {},
      skipped: ['f:0123456789ab'],
      missing: ['f:0123456789ab'],
    })
    void service.request([target('f:0123456789ab', { kind: 'path', path: 'C:\\a.exe' })])
    await flush()
    expect(workers[0]!.posted).toHaveLength(2)
  })

  it('a worker that never replies is terminated after 6 seconds, the request answers empty and the next request spawns a new worker', async () => {
    const { service, workers, advance, flush } = setup()
    const stuck = service.request([target('ext:txt')])
    await flush()
    advance(ICON_WORKER_TIMEOUT_MS - 1)
    expect(workers[0]!.terminated).toBe(0)
    advance(1)
    await expect(stuck).resolves.toEqual({ images: {}, skipped: [], missing: ['ext:txt'] })
    expect(workers[0]!.terminated).toBe(1)
    const next = service.request([target('ext:txt')])
    await flush()
    expect(workers).toHaveLength(2)
    workers[1]!.answer(0)
    await expect(next).resolves.toMatchObject({ images: { 'ext:txt': IMAGE } })
  })

  it('a worker that has not reported ready is never terminated: it only gets the exit message', async () => {
    const { service, workers, advance, flush } = setup(false)
    const stuck = service.request([target('ext:txt')])
    await flush()
    advance(ICON_WORKER_TIMEOUT_MS) // koffi is still loading: the request clock has not started
    expect(workers[0]!.exitMessages).toBe(0)
    advance(ICON_LOAD_TIMEOUT_MS - ICON_WORKER_TIMEOUT_MS)
    await expect(stuck).resolves.toEqual({ images: {}, skipped: [], missing: ['ext:txt'] })
    expect(workers[0]!.terminated).toBe(0)
    expect(workers[0]!.exitMessages).toBe(1)
    void service.request([target('ext:txt')])
    await flush()
    expect(workers).toHaveLength(2)
  })

  it('the request clock starts when the worker reports ready', async () => {
    const { service, workers, advance, flush } = setup(false)
    const request = service.request([target('ext:txt')])
    await flush()
    advance(ICON_LOAD_TIMEOUT_MS - 1000) // a slow cold load, still within the load deadline
    workers[0]!.ready()
    advance(ICON_WORKER_TIMEOUT_MS - 1)
    expect(workers[0]!.terminated).toBe(0)
    workers[0]!.answer(0)
    await expect(request).resolves.toMatchObject({ images: { 'ext:txt': IMAGE } })
  })

  it('a timed-out per-file key is not retried within the negative TTL, and type keys of the same request still answer', async () => {
    const { service, workers, advance, flush } = setup()
    const file = { kind: 'path', path: 'C:\\Share\\hang.exe' } as const
    const mixed = service.request([target('f:0123456789ab', file), target('ext:txt')])
    await flush()
    // The type key went out first, in its own message, and is answered.
    expect(workers[0]!.items(0)).toEqual(['ext:txt'])
    workers[0]!.answer(0)
    await flush()
    expect(workers[0]!.items(1)).toEqual(['f:0123456789ab'])
    advance(ICON_WORKER_TIMEOUT_MS) // the per-file lookup hangs
    const result = await mixed
    expect(result.images['ext:txt']).toEqual(IMAGE)
    expect(result.missing).toEqual(['f:0123456789ab'])
    expect(result.skipped).toEqual([])
    const posted = workers.flatMap((worker) => worker.posted).length
    const again = await service.request([target('f:0123456789ab', file)])
    expect(again.missing).toEqual(['f:0123456789ab'])
    expect(workers.flatMap((worker) => worker.posted)).toHaveLength(posted)
    advance(NEGATIVE_TTL_MS)
    void service.request([target('f:0123456789ab', file)])
    await flush()
    expect(workers.flatMap((worker) => worker.posted)).toHaveLength(posted + 1)
  })

  it('a worker that exits mid-request answers empty and never throws', async () => {
    const { service, workers, flush } = setup()
    const crashed = service.request([target('ext:txt')])
    await flush()
    workers[0]!.crash()
    await expect(crashed).resolves.toEqual({ images: {}, skipped: [], missing: ['ext:txt'] })
    const errored = service.request([target('ext:pdf')])
    await flush()
    workers[1]!.fail()
    await expect(errored).resolves.toEqual({ images: {}, skipped: [], missing: ['ext:pdf'] })
  })

  it('an idle worker is terminated after 60 seconds and respawned on demand', async () => {
    const { service, workers, advance, flush } = setup()
    const first = service.request([target('ext:txt')])
    await flush()
    workers[0]!.answer(0)
    await first
    advance(ICON_IDLE_MS - 1)
    expect(workers[0]!.terminated).toBe(0)
    advance(1)
    expect(workers[0]!.terminated).toBe(1)
    void service.request([target('ext:pdf')])
    await flush()
    expect(workers).toHaveLength(2)
  })

  it('the queue holds at most 8 requests and drops the oldest with an empty answer', async () => {
    const { service, workers, flush } = setup()
    expect(ICON_QUEUE_MAX).toBe(8)
    const inFlight = service.request([target('ext:q0')])
    await flush()
    const queued = Array.from({ length: ICON_QUEUE_MAX }, (_, i) =>
      service.request([target(`ext:q${i + 1}`)]),
    )
    await flush()
    // Eight are waiting; the ninth displaces the oldest one.
    const ninth = service.request([target('ext:q9')])
    await expect(queued[0]).resolves.toEqual({ images: {}, skipped: [], missing: ['ext:q1'] })
    expect(workers[0]!.posted).toHaveLength(1)
    workers[0]!.answer(0)
    await expect(inFlight).resolves.toMatchObject({ images: { 'ext:q0': IMAGE } })
    for (let i = 1; i <= 8; i += 1) {
      await flush()
      workers[0]!.answer()
    }
    await expect(ninth).resolves.toMatchObject({ images: { 'ext:q9': IMAGE } })
    await expect(queued[7]).resolves.toMatchObject({ images: { 'ext:q8': IMAGE } })
  })

  it('a new scan clears the per-file keys and keeps the type keys', async () => {
    const { service, workers, flush } = setup()
    const path = { kind: 'path', path: 'C:\\a.exe' } as const
    const first = service.request([target('ext:txt'), target('f:0123456789ab', path)])
    await flush()
    workers[0]!.answer(0) // type keys go first, in their own message
    await flush()
    workers[0]!.answer(1)
    await first
    service.newScan()
    const again = await service.request([target('ext:txt')])
    expect(again.images['ext:txt']).toEqual(IMAGE)
    expect(workers[0]!.posted).toHaveLength(2)
    void service.request([target('f:0123456789ab', path)])
    await flush()
    expect(workers[0]!.posted).toHaveLength(3)
  })

  it('dispose terminates the worker and answers pending requests empty', async () => {
    const { service, workers, flush } = setup()
    const running = service.request([target('ext:txt')])
    await flush()
    const waiting = service.request([target('ext:pdf')])
    await flush()
    service.dispose()
    await expect(running).resolves.toEqual({ images: {}, skipped: [], missing: ['ext:txt'] })
    await expect(waiting).resolves.toEqual({ images: {}, skipped: [], missing: ['ext:pdf'] })
    expect(workers[0]!.terminated).toBe(1)
    await expect(service.request([target('ext:doc')])).resolves.toEqual({
      images: {},
      skipped: [],
      missing: ['ext:doc'],
    })
    expect(workers).toHaveLength(1)
  })

  it('knownFolders asks the worker once and lower-cases the paths', async () => {
    const { service, workers, flush } = setup()
    const first = service.knownFolders()
    await flush()
    workers[0]!.answerKnown(['C:\\Users\\Ana\\Downloads', 'C:\\Users\\Ana\\'])
    const set = await first
    expect([...set].sort()).toEqual(['c:\\users\\ana', 'c:\\users\\ana\\downloads'])
    await service.knownFolders()
    expect(workers[0]!.posted).toHaveLength(1)
  })
})
