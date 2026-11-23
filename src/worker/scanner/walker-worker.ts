import { parentPort, workerData } from 'node:worker_threads'
import { batchTransferList } from './walker-batch'
import { runJob } from './walker-job'
import type { PoolReply, PoolRequest } from './walker-pool'
import { createWinFindSyncLister } from './win-find'

/**
 * Worker thread entry (built to out/main/walker.js). No logic of its own: it wires the koffi sync
 * lister and `runJob` to the parent port. The abort flag is a SharedArrayBuffer word read with
 * Atomics; a finished job is answered with `result`, or with `aborted` when the flag is set.
 */
const port = parentPort
if (port === null) throw new Error('walker-worker must run in a worker thread')

const flag = new Int32Array((workerData as { abortFlag: SharedArrayBuffer }).abortFlag)
const aborted = (): boolean => Atomics.load(flag, 0) === 1
const send = (message: PoolReply, transfer?: ArrayBuffer[]): void => {
  port.postMessage(message, transfer ?? [])
}
const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

createWinFindSyncLister().then(
  (lister) => {
    port.on('message', (request: PoolRequest) => {
      if (request.type === 'exit') {
        port.close() // nothing else holds the thread open, so it ends
        return
      }
      try {
        const batch = runJob(request.dirPath, lister, aborted)
        if (aborted()) send({ type: 'aborted', jobId: request.jobId })
        else send({ type: 'result', jobId: request.jobId, batch }, batchTransferList(batch))
      } catch (error) {
        send({ type: 'fatal', message: describe(error) })
      }
    })
    send({ type: 'ready' })
  },
  (error: unknown) => send({ type: 'fatal', message: describe(error) }),
)
