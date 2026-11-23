import type { SyncLister } from '../walk'
import { batchTransferList } from '../walker-batch'
import { runJob } from '../walker-job'
import type { PoolReply, PoolRequest, WalkerPort } from '../walker-pool'

export interface FakeWalkerPortOptions {
  /** Milliseconds before the reply of this job is delivered (forces out-of-order arrival). */
  replyDelayMs?(jobId: number): number
  /** The nth job this port receives makes it emit an `error` event instead of replying. */
  crashOnJob?: number
  /** Jobs are accepted and never answered (a worker stuck in a kernel call). */
  neverReply?: boolean
  /** The port emits an `error` event right away and never reports `ready`. */
  startupFails?: boolean
  /** The port stays alive but never reports `ready` (a thread still loading koffi). */
  neverReady?: boolean
}

/**
 * A `WalkerPort` that runs the worker's job in the same thread. A reply travels like a real one:
 * the typed-array buffers are transferred by a structured clone. The abort flag is read exactly
 * as a worker reads it.
 */
export class FakeWalkerPort implements WalkerPort {
  terminated = 0
  /** How many `{ type: 'exit' }` messages this port received. */
  exitsSeen = 0
  jobsSeen = 0
  /** Job ids received, in order. */
  readonly jobIds: number[] = []
  /** The first job's pending folder count (to see that work is handed back). */
  firstJobPending: number | null = null
  private gone = false
  private readonly flag: Int32Array
  private readonly messageHandlers: Array<(message: PoolReply) => void> = []
  private readonly errorHandlers: Array<(error: Error) => void> = []
  private readonly exitHandlers: Array<(code: number) => void> = []

  constructor(
    private readonly lister: SyncLister,
    abortFlag: SharedArrayBuffer,
    private readonly options: FakeWalkerPortOptions = {},
  ) {
    this.flag = new Int32Array(abortFlag)
    if (options.startupFails) {
      queueMicrotask(() => this.emitError(new Error('cannot load the disk reader')))
    } else if (!options.neverReady) {
      queueMicrotask(() => this.deliver({ type: 'ready' }))
    }
  }

  postMessage(message: PoolRequest): void {
    if (this.gone) return
    if (message.type === 'exit') {
      this.exitsSeen += 1
      return
    }
    const { jobId, dirPath } = message
    this.jobsSeen += 1
    this.jobIds.push(jobId)
    if (this.options.neverReply) return
    if (this.options.crashOnJob === this.jobsSeen) {
      queueMicrotask(() => this.emitError(new Error('worker crashed')))
      return
    }
    const batch = runJob(dirPath, this.lister, () => Atomics.load(this.flag, 0) === 1)
    if (this.firstJobPending === null) this.firstJobPending = batch.pendingLocal.length
    const reply = (): void => {
      if (Atomics.load(this.flag, 0) === 1) {
        this.deliver({ type: 'aborted', jobId })
        return
      }
      const cloned = structuredClone(batch, { transfer: batchTransferList(batch) })
      this.deliver({ type: 'result', jobId, batch: cloned })
    }
    const delay = this.options.replyDelayMs?.(jobId) ?? 0
    if (delay > 0) setTimeout(reply, delay)
    else queueMicrotask(reply)
  }

  on(event: 'message', fn: (message: PoolReply) => void): void
  on(event: 'error', fn: (error: Error) => void): void
  on(event: 'exit', fn: (code: number) => void): void
  on(event: string, fn: (value: never) => void): void {
    if (event === 'message') this.messageHandlers.push(fn as (message: PoolReply) => void)
    else if (event === 'error') this.errorHandlers.push(fn as (error: Error) => void)
    else if (event === 'exit') this.exitHandlers.push(fn as (code: number) => void)
  }

  terminate(): Promise<number> {
    this.terminated += 1
    this.gone = true
    return Promise.resolve(1)
  }

  private deliver(message: PoolReply): void {
    if (this.gone) return
    for (const handler of this.messageHandlers) handler(message)
  }

  private emitError(error: Error): void {
    if (this.gone) return
    for (const handler of this.errorHandlers) handler(error)
  }
}
