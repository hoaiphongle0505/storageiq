import type { IconImage } from '@shared/ipc-contract'
import type { NativeTarget } from './icon-keys'

/** One lookup: the cache key it answers and what to ask Windows for. */
export interface IconWorkItem {
  key: string
  target: NativeTarget
}

/** Main → worker. Plain JSON; `path` targets are scanner paths only. */
export type IconWorkerRequest =
  | { type: 'get'; id: number; items: IconWorkItem[] }
  /** The paths of Desktop, Documents, Downloads, Pictures, Music, Videos and the user profile. */
  | { type: 'known-folders'; id: number }
  /** Close the worker once it has finished loading (used instead of terminate() before `ready`). */
  | { type: 'exit' }

export interface IconWorkResult {
  key: string
  /** `null` when Windows had no icon or the item was not tried (`skipped`). */
  image: IconImage | null
  /** The real bitmap sizes in pixels (they follow the system metrics, not 16 and 32). */
  size: { small: number; large: number } | null
  /** The time budget ran out before this item was tried: ask again later, do not remember it. */
  skipped?: true
}

/** Worker → main. */
export type IconWorkerReply =
  /** koffi is loaded and COM is initialised: the thread may be terminated from now on. */
  | { type: 'ready' }
  | { type: 'icons'; id: number; results: IconWorkResult[]; ms: number }
  | { type: 'known-folders'; id: number; paths: string[] }
  | { type: 'failed'; id: number; hresult: number; step: string }

/** One `get` request is answered within this time; the items not tried by then are `skipped`. */
export const ICON_REQUEST_BUDGET_MS = 2_500
/** The main-side client gives up on a request after this long and discards the worker. */
export const ICON_WORKER_TIMEOUT_MS = 6_000
/** Before the worker reports `ready` (koffi still loading) it is given this long. */
export const ICON_LOAD_TIMEOUT_MS = 20_000
/** Requests waiting for the worker (an older one is dropped with an empty answer). */
export const ICON_QUEUE_MAX = 8
/** An idle worker is ended after this long. */
export const ICON_IDLE_MS = 60_000
/** Items in one worker message. */
export const ICON_MAX_ITEMS_PER_MESSAGE = 64

/** The service starts the worker with this `workerData`, so importing the file never starts it. */
export const ICON_WORKER_DATA = { storageiqIconWorker: true } as const
