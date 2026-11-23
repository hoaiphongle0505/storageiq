import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import type { IconImage } from '@shared/ipc-contract'
import { safeExtension, type NativeTarget } from './icon-keys'
import {
  ICON_REQUEST_BUDGET_MS,
  ICON_WORKER_DATA,
  type IconWorkerReply,
  type IconWorkerRequest,
  type IconWorkResult,
} from './icon-worker-protocol'
import { encodeRgbaPng, type RgbaBitmap } from './png'
import { createWinIcons } from './win-icons'

/**
 * Worker thread entry (built to out/main/icon-worker.js) and the orchestration of one icon
 * request. `SHGetFileInfoW` is a shell call: for `.exe`, `.lnk`, `.url` and `.ico` it opens the
 * file, can load shell extensions, and on a slow or offline drive can block for seconds, so it
 * runs on this dedicated STA thread and never on Electron's UI thread, and not in the shell
 * worker pool (whose workers are held for whole menus and recycle operations). One request at a
 * time; the main-side client (`icon-service.ts`) times a request out and discards the thread.
 */

type Post = (reply: IconWorkerReply) => void

/** What the orchestration needs from Windows; `createWinIcons` is the real one, tests pass a fake. */
export interface IconNative {
  fetch(target: NativeTarget): { small: RgbaBitmap; large: RgbaBitmap } | null
  attributes(path: string): number | null
  knownFolders(): string[]
  dispose(): void
}

// winnt.h: a file that is only a cloud placeholder or lives offline. Looking its icon up would
// open the file and download it, so such a file gets the by-extension icon instead.
const FILE_ATTRIBUTE_OFFLINE = 0x1000
const FILE_ATTRIBUTE_RECALL_ON_OPEN = 0x00040000
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS = 0x00400000
const FILE_ATTRIBUTE_DIRECTORY = 0x10
const NOT_LOCAL =
  FILE_ATTRIBUTE_OFFLINE | FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS

const isDriveRootPath = (path: string): boolean => /^[A-Za-z]:\\?$/.test(path)

/**
 * Cloud placeholders are never hydrated: before a path lookup the attributes are read; if the
 * call fails or any of the offline or recall flags is set, the lookup is by type instead.
 */
function resolveTarget(native: IconNative, target: NativeTarget): NativeTarget {
  if (target.kind !== 'path' || isDriveRootPath(target.path)) return target
  const attributes = native.attributes(target.path)
  if (attributes !== null && (attributes & NOT_LOCAL) === 0) return target
  if (attributes !== null && (attributes & FILE_ATTRIBUTE_DIRECTORY) !== 0) return { kind: 'dir' }
  return {
    kind: 'file',
    ext: safeExtension(target.path.slice(target.path.lastIndexOf('\\') + 1)),
  }
}

const dataUrl = (bitmap: RgbaBitmap): string =>
  `data:image/png;base64,${Buffer.from(encodeRgbaPng(bitmap)).toString('base64')}`

function lookup(native: IconNative, target: NativeTarget): IconWorkResult | null {
  const bitmaps = native.fetch(resolveTarget(native, target))
  if (bitmaps === null) return null
  const image: IconImage = { small: dataUrl(bitmaps.small), large: dataUrl(bitmaps.large) }
  return {
    key: '',
    image,
    size: { small: bitmaps.small.width, large: bitmaps.large.width },
  }
}

/**
 * Answers one `get` request in input order. After `budgetMs` the items not yet tried are marked
 * `skipped` (the service asks again later); an item whose lookup throws answers `null` and the
 * rest go on.
 */
export function runGetRequest(
  native: IconNative,
  request: Extract<IconWorkerRequest, { type: 'get' }>,
  post: Post,
  clock: { now(): number; budgetMs: number } = {
    now: () => performance.now(),
    budgetMs: ICON_REQUEST_BUDGET_MS,
  },
): void {
  const started = clock.now()
  const results: IconWorkResult[] = []
  for (const item of request.items) {
    if (clock.now() - started >= clock.budgetMs) {
      results.push({ key: item.key, image: null, size: null, skipped: true })
      continue
    }
    let found: IconWorkResult | null
    try {
      found = lookup(native, item.target)
    } catch {
      found = null
    }
    results.push(
      found === null ? { key: item.key, image: null, size: null } : { ...found, key: item.key },
    )
  }
  post({ type: 'icons', id: request.id, results, ms: Math.round(clock.now() - started) })
}

/** Answers with the known folders' paths. */
export function runKnownFoldersRequest(
  native: IconNative,
  request: Extract<IconWorkerRequest, { type: 'known-folders' }>,
  post: Post,
): void {
  let paths: string[]
  try {
    paths = native.knownFolders()
  } catch {
    paths = []
  }
  post({ type: 'known-folders', id: request.id, paths })
}

if (
  !isMainThread &&
  parentPort !== null &&
  (workerData as { storageiqIconWorker?: boolean } | null)?.storageiqIconWorker ===
    ICON_WORKER_DATA.storageiqIconWorker
) {
  const port = parentPort
  const post: Post = (reply) => port.postMessage(reply)
  createWinIcons().then(
    (native) => {
      port.on('message', (request: IconWorkerRequest) => {
        if (request.type === 'get') runGetRequest(native, request, post)
        else if (request.type === 'known-folders') runKnownFoldersRequest(native, request, post)
        else {
          // `exit`: the client discarded this worker. Closing the port ends the thread.
          native.dispose()
          port.close()
        }
      })
      // Only now may the main thread terminate this worker: koffi is loaded.
      post({ type: 'ready' })
    },
    () => {
      // The shell could not be loaded: answer every request with a failure (and let the client
      // close the thread, which is safe, nothing native is half-loaded).
      post({ type: 'ready' })
      port.on('message', (request: IconWorkerRequest) => {
        if (request.type === 'exit') port.close()
        else post({ type: 'failed', id: request.id, hresult: -2147467259, step: 'load' })
      })
    },
  )
}
