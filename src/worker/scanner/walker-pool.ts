import os from 'node:os'
import type { WalkSink } from './walk'
import { decodeBatch, type ResultBatch } from './walker-batch'

/**
 * Parallel directory walk with a pool of worker threads. The coordinator (the scanner host
 * thread) is the only writer of the TreeStore: workers list directories synchronously and send
 * back batches (`walker-batch.ts`), the coordinator decodes them through the sink.
 *
 * Distribution: a LIFO stack of `{ path, handle }`, seeded with the root. A free worker takes the
 * top entry, one job per worker at a time. A job walks up to a budget of directories and returns
 * what it did not walk as pending folders, which become new stack entries (that is the work
 * stealing). Batches may arrive in any order: a batch only refers to its own root handle.
 *
 * `sink.visiting` is called once per batch (the last directory of the job), not once per
 * directory, so `currentPath` in the progress snapshots is coarser than in the single-thread walk
 * but still moves several times per second.
 *
 * Abort: one shared abort flag (`Atomics`) is read by every worker. After an abort the pool makes
 * no more sink calls, starts no job, waits for the in-flight jobs to reply (workers stop at their
 * next check and `FindClose` in a `finally`), tells every worker to exit and terminates them.
 * A worker stuck in a blocked kernel open (a dead network share) cannot be interrupted:
 * `terminate()` does not break a thread out of a native call, so after `ABORT_GRACE_MS` the pool
 * calls `terminate()` without awaiting it and resolves anyway; that thread ends when the call
 * returns or when the process exits. The pool is created per walk and torn down in every case.
 */

export const MIN_WALKERS = 2
export const MAX_WALKERS = 8
export const ABORT_GRACE_MS = 2000

export const WALKER_ERROR_PREFIX = 'The disk reader stopped unexpectedly'

/** One core stays for the coordinator and the UI. */
export function walkerCount(parallelism: number): number {
  return Math.min(MAX_WALKERS, Math.max(MIN_WALKERS, parallelism - 1))
}

export function defaultWalkerCount(): number {
  return walkerCount(os.availableParallelism())
}

/**
 * `STORAGEIQ_WALKERS`: "1".."8" is that number, anything else the fallback. A packaged app
 * ignores it: the override is for the bench, support and tests, not for an installed app.
 */
export function walkerCountFromEnv(
  value: string | undefined,
  fallback: number,
  packaged = false,
): number {
  if (packaged || value === undefined || !/^[1-8]$/.test(value)) return fallback
  return Number(value)
}

/** Every worker failed before it reported `ready` (koffi cannot load in a thread, script missing). */
export class WalkerStartupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WalkerStartupError'
  }
}

export type PoolRequest = { type: 'job'; jobId: number; dirPath: string } | { type: 'exit' }
export type PoolReply =
  | { type: 'ready' }
  | { type: 'result'; jobId: number; batch: ResultBatch }
  | { type: 'aborted'; jobId: number }
  | { type: 'fatal'; message: string }

/** The subset of `worker_threads.Worker` the pool uses. */
export interface WalkerPort {
  postMessage(message: PoolRequest, transfer?: ArrayBuffer[]): void
  on(event: 'message', fn: (message: PoolReply) => void): void
  on(event: 'error', fn: (error: Error) => void): void
  on(event: 'exit', fn: (code: number) => void): void
  terminate(): Promise<number>
}

export interface PoolDeps {
  createPort(index: number, abortFlag: SharedArrayBuffer): WalkerPort
  walkers: number
}

interface Slot<D> {
  port: WalkerPort
  ready: boolean
  /** Died before it reported ready (startup failure); never gets a job. */
  deadAtStart: boolean
  /** Failed or exited; no reply will come. */
  dead: boolean
  job: { jobId: number; handle: D } | null
}

type Outcome = { kind: 'ok' } | { kind: 'abort' } | { kind: 'fail'; error: Error }

export function createWalkerPool(deps: PoolDeps): {
  walk<D>(
    rootPath: string,
    rootHandle: D,
    sink: WalkSink<D>,
    signal: AbortSignal,
  ): Promise<{ walkers: number }>
} {
  return {
    walk<D>(
      rootPath: string,
      rootHandle: D,
      sink: WalkSink<D>,
      signal: AbortSignal,
    ): Promise<{ walkers: number }> {
      const abortFlag = new SharedArrayBuffer(4)
      const flag = new Int32Array(abortFlag)
      const queue: Array<{ path: string; handle: D }> = [{ path: rootPath, handle: rootHandle }]
      const slots: Array<Slot<D>> = []
      let phase: 'running' | 'stopping' | 'done' = 'running'
      let outcome: Outcome = { kind: 'ok' }
      let nextJobId = 1
      let dispatched = 0
      let graceTimer: ReturnType<typeof setTimeout> | null = null

      return new Promise<{ walkers: number }>((resolve, reject) => {
        // After an abort or a failure no sink call may happen, not even the rest of a batch that
        // is being decoded when the abort comes from inside a sink call.
        const guarded: WalkSink<D> = {
          folder: (parent, name, modifiedMs) =>
            phase === 'running' ? sink.folder(parent, name, modifiedMs) : parent,
          file: (parent, bytes, name, modifiedMs) => {
            if (phase === 'running') sink.file(parent, bytes, name, modifiedMs)
          },
          error: (errorPath, code, kind) => {
            if (phase === 'running') sink.error(errorPath, code, kind)
          },
          visiting: (visitedPath) => {
            if (phase === 'running') sink.visiting(visitedPath)
          },
        }
        const inFlight = (): number => slots.filter((s) => s.job !== null && !s.dead).length
        const live = (): number => slots.filter((s) => !s.deadAtStart).length

        const settle = async (graceExpired: boolean): Promise<void> => {
          if (phase === 'done') return
          phase = 'done'
          if (graceTimer !== null) clearTimeout(graceTimer)
          signal.removeEventListener('abort', onAbort)
          const stuck = slots.filter((s) => s.job !== null && !s.dead)
          for (const slot of slots) {
            if (slot.dead) continue
            try {
              slot.port.postMessage({ type: 'exit' })
            } catch {
              // the thread is already gone
            }
          }
          if (graceExpired && stuck.length > 0) {
            console.warn(
              `walker pool: ${stuck.length} worker(s) did not stop within ${ABORT_GRACE_MS} ms; terminating`,
            )
          }
          const waits: Array<Promise<unknown>> = []
          for (const slot of slots) {
            let ended: Promise<unknown>
            try {
              ended = Promise.resolve(slot.port.terminate()).catch(() => undefined)
            } catch {
              ended = Promise.resolve()
            }
            if (!stuck.includes(slot)) waits.push(ended)
          }
          await Promise.all(waits)
          if (outcome.kind === 'fail') reject(outcome.error)
          else resolve({ walkers: live() })
        }

        const maybeSettle = (): void => {
          if (phase === 'running') {
            if (queue.length === 0 && inFlight() === 0 && dispatched > 0) {
              phase = 'stopping'
              outcome = { kind: 'ok' }
              void settle(false)
            }
            return
          }
          if (phase === 'stopping' && inFlight() === 0) void settle(false)
        }

        const stop = (next: Outcome): void => {
          if (phase !== 'running') return
          phase = 'stopping'
          outcome = next
          Atomics.store(flag, 0, 1)
          if (inFlight() === 0) {
            void settle(false)
          } else {
            graceTimer = setTimeout(() => {
              graceTimer = null
              void settle(true)
            }, ABORT_GRACE_MS)
          }
        }

        const dispatch = (): void => {
          if (phase !== 'running') return
          for (const slot of slots) {
            if (queue.length === 0) return
            if (!slot.ready || slot.dead || slot.job !== null) continue
            const next = queue.pop()
            if (next === undefined) return
            const jobId = nextJobId
            nextJobId += 1
            slot.job = { jobId, handle: next.handle }
            dispatched += 1
            slot.port.postMessage({ type: 'job', jobId, dirPath: next.path })
          }
        }

        const failSlot = (slot: Slot<D>, message: string): void => {
          if (slot.dead || phase === 'done') return
          slot.dead = true
          slot.job = null
          if (!slot.ready) {
            slot.deadAtStart = true
            if (slots.every((s) => s.deadAtStart)) {
              if (phase === 'running') {
                stop({
                  kind: 'fail',
                  error: new WalkerStartupError(`${WALKER_ERROR_PREFIX}: ${message}`),
                })
              }
              return
            }
            // Other workers are fine: carry on with a smaller pool.
            if (phase === 'running') dispatch()
            maybeSettle()
            return
          }
          if (phase === 'running') {
            stop({ kind: 'fail', error: new Error(`${WALKER_ERROR_PREFIX}: ${message}`) })
          } else {
            maybeSettle()
          }
        }

        const onMessage = (slot: Slot<D>, message: PoolReply): void => {
          if (phase === 'done' || slot.dead) return
          switch (message.type) {
            case 'ready':
              slot.ready = true
              dispatch()
              return
            case 'fatal':
              failSlot(slot, message.message)
              return
            case 'aborted': {
              slot.job = null
              maybeSettle()
              return
            }
            case 'result': {
              const job = slot.job
              slot.job = null
              if (phase !== 'running' || job === null) {
                maybeSettle()
                return
              }
              try {
                for (const pending of decodeBatch(message.batch, job.handle, guarded)) {
                  queue.push({ path: pending.path, handle: pending.handle })
                }
              } catch (error) {
                stop({
                  kind: 'fail',
                  error: error instanceof Error ? error : new Error(String(error)),
                })
                return
              }
              dispatch()
              maybeSettle()
              return
            }
          }
        }

        const onAbort = (): void => stop({ kind: 'abort' })

        for (let index = 0; index < deps.walkers; index += 1) {
          let port: WalkerPort
          try {
            port = deps.createPort(index, abortFlag)
          } catch (error) {
            const dead: Slot<D> = {
              port: { postMessage: () => undefined, on: () => undefined, terminate: async () => 0 },
              ready: false,
              deadAtStart: true,
              dead: true,
              job: null,
            }
            slots.push(dead)
            if (slots.length === deps.walkers && slots.every((s) => s.deadAtStart)) {
              phase = 'done'
              reject(
                new WalkerStartupError(
                  `${WALKER_ERROR_PREFIX}: ${error instanceof Error ? error.message : String(error)}`,
                ),
              )
              return
            }
            continue
          }
          const slot: Slot<D> = { port, ready: false, deadAtStart: false, dead: false, job: null }
          slots.push(slot)
          port.on('message', (message) => onMessage(slot, message))
          port.on('error', (error) => failSlot(slot, error.message))
          port.on('exit', (code) => {
            failSlot(slot, `a worker exited (code ${code})`)
          })
        }

        if (signal.aborted) {
          stop({ kind: 'abort' })
        } else {
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    },
  }
}
