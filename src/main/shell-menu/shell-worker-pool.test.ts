import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellMenuRequest } from './context-menu'
import { ShellMenuError } from './shell-menu-error'
import { createShellWorkerPool, ShellBusyError, type WorkerLike } from './shell-worker-pool'
import type { WorkerReply, WorkerRequest } from './shell-worker-protocol'

class FakeWorker implements WorkerLike {
  readonly posted: WorkerRequest[] = []
  terminated = false
  private readonly listeners: {
    message: Array<(message: WorkerReply) => void>
    error: Array<(error: Error) => void>
    exit: Array<(code: number) => void>
  } = { message: [], error: [], exit: [] }

  postMessage(message: WorkerRequest): void {
    this.posted.push(message)
  }
  on(event: 'message', listener: (message: WorkerReply) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  on(event: 'message' | 'error' | 'exit', listener: never): void {
    ;(this.listeners[event] as unknown[]).push(listener)
  }
  terminate(): Promise<number> {
    this.terminated = true
    return Promise.resolve(1)
  }
  reply(message: WorkerReply): void {
    for (const listener of this.listeners.message) listener(message)
  }
  crash(): void {
    for (const listener of this.listeners.exit) listener(3221225477)
  }
  get lastId(): number {
    return this.posted.at(-1)?.id ?? -1
  }
}

const request: ShellMenuRequest = {
  paths: ['D:\\Data\\a.txt'],
  x: 10,
  y: 20,
  extended: false,
  hideDestructive: false,
}

function setup() {
  const workers: FakeWorker[] = []
  const pool = createShellWorkerPool({
    spawn: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    maxWorkers: 3,
    idleMs: 30_000,
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => clearTimeout(timer)
    },
  })
  return { pool, workers }
}

const first = (workers: FakeWorker[]): FakeWorker => {
  const worker = workers[0]
  if (worker === undefined) throw new Error('no worker was spawned')
  return worker
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('shell worker pool', () => {
  it('a request is posted to an idle worker and resolves chosen then finished', async () => {
    const { pool, workers } = setup()
    const shown = pool.show(request)
    const worker = first(workers)
    expect(worker.posted).toEqual([{ type: 'show', id: worker.lastId, ...request }])
    worker.reply({ type: 'chosen', id: worker.lastId, choice: { kind: 'dismissed' } })
    worker.reply({ type: 'finished', id: worker.lastId, ok: true })
    await expect(shown.chosen).resolves.toEqual({ kind: 'dismissed' })
    await expect(shown.finished).resolves.toEqual({ ok: true })
    // The worker is idle again and serves the next request without a new thread.
    pool.show(request)
    expect(workers).toHaveLength(1)
    expect(worker.posted).toHaveLength(2)
  })

  it('chosen resolves before finished', async () => {
    const { pool, workers } = setup()
    const { chosen, finished } = pool.show(request)
    const order: string[] = []
    void chosen.then(() => order.push('chosen'))
    void finished.then(() => order.push('finished'))
    const worker = first(workers)
    worker.reply({
      type: 'chosen',
      id: worker.lastId,
      choice: { kind: 'shell', verb: 'delete', changed: true },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['chosen'])
    worker.reply({
      type: 'finished',
      id: worker.lastId,
      ok: false,
      hresult: 0x80270000,
      step: 'InvokeCommand',
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual(['chosen', 'finished'])
    await expect(finished).resolves.toEqual({
      ok: false,
      hresult: 0x80270000,
      step: 'InvokeCommand',
    })
  })

  it('a second request while the first runs spawns a second worker', () => {
    const { pool, workers } = setup()
    pool.show(request)
    pool.show(request)
    expect(workers).toHaveLength(2)
    expect(workers[0]?.posted).toHaveLength(1)
    expect(workers[1]?.posted).toHaveLength(1)
  })

  it('the fourth concurrent request rejects with ShellBusyError', () => {
    const { pool, workers } = setup()
    pool.show(request)
    pool.show(request)
    pool.show(request)
    expect(() => pool.show(request)).toThrow(ShellBusyError)
    expect(workers).toHaveLength(3)
    expect(pool.size).toBe(3)
  })

  it('an idle worker is terminated after the idle time and a later request spawns a new one', async () => {
    const { pool, workers } = setup()
    pool.show(request)
    const worker = first(workers)
    worker.reply({ type: 'chosen', id: worker.lastId, choice: { kind: 'dismissed' } })
    worker.reply({ type: 'finished', id: worker.lastId, ok: true })
    await vi.advanceTimersByTimeAsync(29_999)
    expect(worker.terminated).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(worker.terminated).toBe(true)
    expect(pool.size).toBe(0)
    pool.show(request)
    expect(workers).toHaveLength(2)
  })

  it('a worker that exits mid-request rejects chosen with a plain Error', async () => {
    const { pool, workers } = setup()
    const { chosen, finished } = pool.show(request)
    first(workers).crash()
    const error = await chosen.then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(ShellMenuError)
    await expect(finished).resolves.toMatchObject({ ok: false, step: 'worker' })
    expect(pool.size).toBe(0)
  })

  it('a worker that exits after chosen resolves finished with ok false', async () => {
    const { pool, workers } = setup()
    const { chosen, finished } = pool.show(request)
    const worker = first(workers)
    worker.reply({
      type: 'chosen',
      id: worker.lastId,
      choice: { kind: 'shell', verb: 'delete', changed: true },
    })
    await expect(chosen).resolves.toMatchObject({ kind: 'shell' })
    worker.crash()
    await expect(finished).resolves.toEqual({ ok: false, hresult: 0x80004005, step: 'worker' })
  })

  it('a failed message becomes a ShellMenuError with the hresult', async () => {
    const { pool, workers } = setup()
    const { chosen } = pool.show(request)
    const worker = first(workers)
    worker.reply({
      type: 'failed',
      id: worker.lastId,
      hresult: 0x80070002,
      step: 'SHParseDisplayName',
    })
    const error = await chosen.then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(ShellMenuError)
    expect((error as ShellMenuError).hresult).toBe(0x80070002)
    expect((error as ShellMenuError).step).toBe('SHParseDisplayName')
    // The worker survived and is free again.
    pool.show(request)
    expect(workers).toHaveLength(1)
  })

  it('dispose terminates every worker and rejects pending requests', async () => {
    const { pool, workers } = setup()
    const a = pool.show(request)
    const b = pool.show(request)
    pool.dispose()
    expect(workers.every((worker) => worker.terminated)).toBe(true)
    await expect(a.chosen).rejects.toThrow('disposed')
    await expect(b.chosen).rejects.toThrow('disposed')
    await expect(a.finished).resolves.toMatchObject({ ok: false })
    expect(() => pool.show(request)).toThrow()
  })

  it('probe resolves with the labels and invokeVerb with the finish', async () => {
    const { pool, workers } = setup()
    const labels = pool.probe(['C:\\'], true)
    const worker = first(workers)
    expect(worker.posted[0]).toMatchObject({
      type: 'probe',
      paths: ['C:\\'],
      hideDestructive: true,
    })
    worker.reply({ type: 'probed', id: worker.lastId, labels: ['Open', ''] })
    await expect(labels).resolves.toEqual(['Open', ''])
    const finish = pool.invokeVerb(['D:\\a'], 'delete')
    expect(worker.posted[1]).toMatchObject({ type: 'invoke-verb', verb: 'delete' })
    worker.reply({ type: 'finished', id: worker.lastId, ok: true })
    await expect(finish).resolves.toEqual({ ok: true })
  })
})
