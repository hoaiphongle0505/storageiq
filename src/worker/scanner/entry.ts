import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { createScannerHost, parseScannerRequest, type ScannerHostDeps } from './scanner-host'
import type { DirectoryLister } from './walk'
import { createWalkerPool, defaultWalkerCount, walkerCountFromEnv } from './walker-pool'
import { createWinFindLister } from './win-find'

export const DISK_READER_MESSAGE = 'The disk reader could not be loaded.'

/**
 * The walker worker script, from the unpacked tree when packaged: a worker thread then loads the
 * script and `require('koffi')` from real files, independent of Electron's asar patching.
 */
export function walkerScriptPath(): string {
  const script = path.join(__dirname, 'walker.js')
  return script.includes('app.asar.unpacked')
    ? script
    : script.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

/** `STORAGEIQ_WALKERS=1` forces the single-thread walk; 2..8 forces that many walkers. */
function createWalkParallel(): ScannerHostDeps['walkParallel'] {
  const walkers = walkerCountFromEnv(process.env['STORAGEIQ_WALKERS'], defaultWalkerCount())
  if (walkers === 1) return undefined
  const pool = createWalkerPool({
    walkers,
    createPort: (index, abortFlag) =>
      new Worker(walkerScriptPath(), { workerData: { abortFlag, index } }),
  })
  return (root, handle, sink, signal) => pool.walk(root, handle, sink, signal)
}

// The listing is created before any request is handled. If koffi cannot load, every scan start
// is answered with a plain failure instead of a silent crash.
const listerPromise: Promise<DirectoryLister | null> = createWinFindLister().catch(() => null)

const hostPromise = listerPromise.then((lister) =>
  lister === null
    ? null
    : createScannerHost({
        lister,
        walkParallel: createWalkParallel(),
        post: (message) => process.parentPort.postMessage(message),
        now: () => performance.now(),
        startTicker: (tick, intervalMs) => {
          const timer = setInterval(tick, intervalMs)
          return () => clearInterval(timer)
        },
      }),
)

process.parentPort.on('message', (event) => {
  const request = parseScannerRequest(event.data)
  if (!request) return
  void hostPromise.then((host) => {
    if (host !== null) {
      host.handle(request)
    } else if (request.type === 'start') {
      process.parentPort.postMessage({
        type: 'failed',
        payload: { scanId: request.scanId, message: DISK_READER_MESSAGE },
      })
    } else if (request.type === 'query') {
      process.parentPort.postMessage({
        type: 'reply',
        requestId: request.requestId,
        ok: false,
        message: DISK_READER_MESSAGE,
      })
    }
  })
})
