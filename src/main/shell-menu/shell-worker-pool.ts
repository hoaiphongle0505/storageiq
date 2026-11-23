import type { ShellFinish, ShellMenuChoice, ShellMenuHost, ShellMenuRequest } from './context-menu'
import { E_FAIL, ShellMenuError } from './shell-menu-error'
import type { WorkerReply, WorkerRequest } from './shell-worker-protocol'

/** The part of a `worker_threads` Worker the pool uses; tests pass a fake. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void
  on(event: 'message', listener: (message: WorkerReply) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  terminate(): Promise<number>
}

/** Three Explorer actions are already running. */
export class ShellBusyError extends Error {
  constructor() {
    super('Windows is still working on earlier actions.')
    this.name = 'ShellBusyError'
  }
}

export interface ShellWorkerPoolDeps {
  spawn(): WorkerLike
  /** At most this many workers exist (and so at most this many actions run) at once. */
  maxWorkers: number
  /** An idle worker is terminated after this long. */
  idleMs: number
  /** Runs `callback` once after `ms`; returns a function that cancels it. */
  schedule(callback: () => void, ms: number): () => void
}

export interface ShellWorkerPool extends ShellMenuHost {
  /** Test only: builds the menu for `paths` and runs the shell verb `verb` without showing it. */
  invokeVerb(paths: string[], verb: string): Promise<ShellFinish>
  /** Number of live workers. */
  readonly size: number
}

/** The error code a dead worker answers with. */
const WORKER_FAILED: ShellFinish = { ok: false, hresult: E_FAIL, step: 'worker' }

interface Pending {
  id: number
  /** True once the worker said the menu closed (so a death now only fails `finished`). */
  chosenDone: boolean
  chosen(choice: ShellMenuChoice): void
  failChosen(error: Error): void
  finish(result: ShellFinish): void
  labels?(labels: string[]): void
}

interface Slot {
  worker: WorkerLike
  pending: Pending | null
  cancelIdle: (() => void) | null
  dead: boolean
}

/**
 * Up to `maxWorkers` shell worker threads. One worker serves one request at a time; an idle
 * worker is reused, a new one is spawned while fewer than `maxWorkers` are busy, otherwise
 * `show` throws `ShellBusyError`. Idle workers end after `idleMs`. A worker that errors or exits
 * is discarded and fails only the request it was serving; the pool never throws into the app.
 */
export function createShellWorkerPool(deps: ShellWorkerPoolDeps): ShellWorkerPool {
  const slots: Slot[] = []
  let nextId = 1
  let disposed = false

  const discard = (slot: Slot): void => {
    if (slot.dead) return
    slot.dead = true
    slot.cancelIdle?.()
    slot.cancelIdle = null
    const index = slots.indexOf(slot)
    if (index !== -1) slots.splice(index, 1)
    slot.worker.terminate().catch(() => undefined)
  }

  const fail = (slot: Slot, error: Error): void => {
    const pending = slot.pending
    slot.pending = null
    discard(slot)
    if (pending === null) return
    if (!pending.chosenDone) pending.failChosen(error)
    pending.finish(WORKER_FAILED)
  }

  const becomeIdle = (slot: Slot): void => {
    slot.pending = null
    if (slot.dead || disposed) return
    slot.cancelIdle = deps.schedule(() => discard(slot), deps.idleMs)
  }

  const onReply = (slot: Slot, reply: WorkerReply): void => {
    const pending = slot.pending
    if (pending === null || pending.id !== reply.id) return
    switch (reply.type) {
      case 'chosen':
        pending.chosenDone = true
        pending.chosen(reply.choice)
        return
      case 'finished':
        if (!pending.chosenDone) {
          // A worker that finishes without a choice (invoke-verb): nothing to deliver.
          pending.chosenDone = true
          pending.chosen({ kind: 'dismissed' })
        }
        becomeIdle(slot)
        pending.finish(
          reply.ok
            ? { ok: true }
            : { ok: false, hresult: reply.hresult ?? E_FAIL, step: reply.step ?? 'invoke' },
        )
        return
      case 'failed': {
        const error = new ShellMenuError(reply.step, reply.hresult)
        becomeIdle(slot)
        if (!pending.chosenDone) pending.failChosen(error)
        pending.finish({ ok: false, hresult: reply.hresult, step: reply.step })
        return
      }
      case 'probed':
        becomeIdle(slot)
        pending.labels?.(reply.labels)
        return
    }
  }

  const spawnSlot = (): Slot => {
    const worker = deps.spawn()
    const slot: Slot = { worker, pending: null, cancelIdle: null, dead: false }
    worker.on('message', (reply) => onReply(slot, reply))
    worker.on('error', (error) => fail(slot, error))
    worker.on('exit', (code) => fail(slot, new Error(`The shell worker stopped (code ${code}).`)))
    slots.push(slot)
    return slot
  }

  /** An idle worker, a new one, or `ShellBusyError`. */
  const acquire = (): Slot => {
    if (disposed) throw new Error('The shell worker pool was disposed.')
    const idle = slots.find((slot) => slot.pending === null && !slot.dead)
    if (idle) {
      idle.cancelIdle?.()
      idle.cancelIdle = null
      return idle
    }
    if (slots.length >= deps.maxWorkers) throw new ShellBusyError()
    return spawnSlot()
  }

  const start = (
    build: (id: number) => WorkerRequest,
    attach: (pending: Pending) => void,
  ): { id: number } => {
    const slot = acquire()
    const id = nextId
    nextId += 1
    const pending: Pending = {
      id,
      chosenDone: false,
      chosen: () => undefined,
      failChosen: () => undefined,
      finish: () => undefined,
    }
    attach(pending)
    slot.pending = pending
    try {
      slot.worker.postMessage(build(id))
    } catch (error) {
      fail(slot, error instanceof Error ? error : new Error(String(error)))
    }
    return { id }
  }

  return {
    get size() {
      return slots.length
    },

    show(request: ShellMenuRequest) {
      let chosen!: Promise<ShellMenuChoice>
      let finished!: Promise<ShellFinish>
      start(
        (id) => ({
          type: 'show',
          id,
          paths: request.paths,
          x: request.x,
          y: request.y,
          extended: request.extended,
          hideDestructive: request.hideDestructive,
        }),
        (pending) => {
          chosen = new Promise<ShellMenuChoice>((resolve, reject) => {
            pending.chosen = resolve
            pending.failChosen = reject
          })
          finished = new Promise<ShellFinish>((resolve) => {
            pending.finish = resolve
          })
        },
      )
      // The caller awaits `chosen`; a rejection nobody awaited is not an unhandled one.
      chosen.catch(() => undefined)
      return { chosen, finished }
    },

    probe(paths: string[], hideDestructive = false) {
      return new Promise<string[]>((resolve, reject) => {
        start(
          (id) => ({ type: 'probe', id, paths, hideDestructive }),
          (pending) => {
            pending.labels = resolve
            pending.failChosen = reject
            pending.finish = (result) => {
              if (!result.ok) reject(new ShellMenuError(result.step, result.hresult))
            }
          },
        )
      })
    },

    invokeVerb(paths: string[], verb: string) {
      return new Promise<ShellFinish>((resolve) => {
        start(
          (id) => ({ type: 'invoke-verb', id, paths, verb }),
          (pending) => {
            pending.finish = resolve
          },
        )
      })
    },

    dispose() {
      disposed = true
      for (const slot of [...slots]) {
        const pending = slot.pending
        slot.pending = null
        discard(slot)
        if (pending !== null) {
          if (!pending.chosenDone)
            pending.failChosen(new Error('The shell worker pool was disposed.'))
          pending.finish(WORKER_FAILED)
        }
      }
    },
  }
}
