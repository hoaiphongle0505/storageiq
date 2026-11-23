import { createScannerHost, parseScannerRequest } from './scanner-host'
import type { DirectoryLister } from './walk'
import { createWinFindLister } from './win-find'

export const DISK_READER_MESSAGE = 'The disk reader could not be loaded.'

// The listing is created before any request is handled. If koffi cannot load, every scan start
// is answered with a plain failure instead of a silent crash.
const listerPromise: Promise<DirectoryLister | null> = createWinFindLister().catch(() => null)

const hostPromise = listerPromise.then((lister) =>
  lister === null
    ? null
    : createScannerHost({
        lister,
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
