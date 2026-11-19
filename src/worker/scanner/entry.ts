import { createScannerHost, parseScannerRequest } from './scanner-host'
import { nodeWalkFs } from './walk'

// Count `.asar` archives on the scanned disk as files; never walk into them as folders.
process.noAsar = true

const host = createScannerHost({
  fs: nodeWalkFs,
  post: (message) => process.parentPort.postMessage(message),
  now: () => performance.now(),
  startTicker: (tick, intervalMs) => {
    const timer = setInterval(tick, intervalMs)
    return () => clearInterval(timer)
  },
})

process.parentPort.on('message', (event) => {
  const request = parseScannerRequest(event.data)
  if (request) host.handle(request)
})
