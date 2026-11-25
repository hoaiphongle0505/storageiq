import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { chooseRoute, type ShellMenuChoice } from './context-menu'
import { classifyCommand, verbChangesFileSystem } from './menu-commands'
import { E_FAIL, ShellMenuError } from './shell-menu-error'
import type { BuiltShellMenu, ShellNative } from './shell-native'
import {
  FALLBACK_RECYCLE_VERB,
  SHELL_WORKER_DATA,
  type WorkerReply,
  type WorkerRequest,
} from './shell-worker-protocol'
import { createWinShellNative, invokeVerbForTest } from './win-shell-menu'

/**
 * Worker thread entry (built to out/main/shell-worker.js) and the orchestration of one menu
 * request. The thread is a COM apartment (STA) with its own hidden owner window, so the Explorer
 * menu, `InvokeCommand` and the shell's progress dialog run here and never on Electron's UI
 * thread. One request at a time; the pool in the main process keeps up to three workers.
 *
 * Crash note: a worker thread isolates blocking, not native crashes. A shell extension that
 * crashes would still take the whole process down. A `utilityProcess` host would isolate that
 * too, but needs `AllowSetForegroundWindow` plumbing and an extra IPC hop; it is not done here.
 */

type Post = (reply: WorkerReply) => void

const failureOf = (error: unknown, fallbackStep: string): { hresult: number; step: string } =>
  error instanceof ShellMenuError
    ? { hresult: error.hresult, step: error.step }
    : { hresult: E_FAIL, step: fallbackStep }

/** The menu for `paths`: the shell's, or StorageIQ's own when the default menu cannot be made. */
function buildMenu(
  native: ShellNative,
  paths: readonly string[],
  extended: boolean,
  hideDestructive: boolean,
): BuiltShellMenu {
  const route = chooseRoute(paths)
  try {
    return native.build(route, paths, { extended, hideDestructive })
  } catch (error) {
    if (
      route === 'default' &&
      error instanceof ShellMenuError &&
      error.step === 'SHCreateDefaultContextMenu'
    ) {
      return native.buildFallback(paths)
    }
    throw error
  }
}

/**
 * Builds, shows and runs one menu. `chosen` is posted as soon as the menu closes, before the
 * command runs; `finished` when the command returned. Everything is released on every path.
 */
export function runShellRequest(
  native: ShellNative,
  request: Extract<WorkerRequest, { type: 'show' }>,
  post: Post,
): void {
  const { id } = request
  let menu: BuiltShellMenu
  try {
    menu = buildMenu(native, request.paths, request.extended, request.hideDestructive)
  } catch (error) {
    post({ type: 'failed', id, ...failureOf(error, 'build') })
    return
  }
  try {
    post({ type: 'tracking', id, hwnd: menu.ownerHandle() })
    const command = classifyCommand(menu.track(request.x, request.y))
    if (command.kind === 'none') {
      post({ type: 'chosen', id, choice: { kind: 'dismissed' } })
      post({ type: 'finished', id, ok: true })
      return
    }
    if (command.kind === 'storageiq' && command.item !== 'delete') {
      post({ type: 'chosen', id, choice: { kind: 'storageiq', item: command.item } })
      post({ type: 'finished', id, ok: true })
      return
    }
    let choice: ShellMenuChoice
    let run: () => void
    if (command.kind === 'storageiq') {
      choice = { kind: 'shell', verb: 'delete', changed: true }
      run = () => menu.recycle()
    } else {
      const verb = menu.verb(command.offset)
      choice = { kind: 'shell', verb, changed: verbChangesFileSystem(verb) }
      run = () => menu.invoke(command.offset, request.x, request.y)
    }
    post({ type: 'chosen', id, choice })
    try {
      run()
      post({ type: 'finished', id, ok: true })
    } catch (error) {
      post({ type: 'finished', id, ok: false, ...failureOf(error, 'invoke') })
    }
  } catch (error) {
    // track() or verb() failed before the menu produced a choice: the request fails as a build.
    post({ type: 'failed', id, ...failureOf(error, 'track') })
  } finally {
    menu.release()
  }
}

/** Builds the menu without showing it; returns its labels. */
export function runProbeRequest(
  native: ShellNative,
  request: Extract<WorkerRequest, { type: 'probe' }>,
  post: Post,
): void {
  try {
    const menu = buildMenu(native, request.paths, false, request.hideDestructive)
    try {
      post({ type: 'probed', id: request.id, labels: menu.labels() })
    } finally {
      menu.release()
    }
  } catch (error) {
    post({ type: 'failed', id: request.id, ...failureOf(error, 'build') })
  }
}

/**
 * Keyboard Delete: builds the menu like a request would (without showing it) and runs the
 * `"delete"` verb. `finished` follows when the shell's copy engine returned.
 */
export function runDeleteRequest(
  native: ShellNative,
  request: Extract<WorkerRequest, { type: 'invoke-delete' }>,
  post: Post,
  noUi = false,
): void {
  const { id } = request
  let menu: BuiltShellMenu
  try {
    menu = buildMenu(native, request.paths, false, false)
  } catch (error) {
    post({ type: 'failed', id, ...failureOf(error, 'build') })
    return
  }
  try {
    menu.invokeDelete(request.permanent, noUi)
    post({ type: 'finished', id, ok: true })
  } catch (error) {
    post({ type: 'finished', id, ok: false, ...failureOf(error, 'invoke') })
  } finally {
    menu.release()
  }
}

/** Empties one drive's Recycle Bin (Windows shows its confirmation and progress). */
export function runEmptyBinRequest(
  native: ShellNative,
  request: Extract<WorkerRequest, { type: 'empty-bin' }>,
  post: Post,
): void {
  try {
    native.emptyRecycleBin(request.root)
    post({ type: 'finished', id: request.id, ok: true })
  } catch (error) {
    post({ type: 'finished', id: request.id, ok: false, ...failureOf(error, 'empty-bin') })
  }
}

/** Test only: builds the menu like a request would and runs one verb without showing it. */
export function runInvokeVerbRequest(
  native: ShellNative,
  request: Extract<WorkerRequest, { type: 'invoke-verb' }>,
  post: Post,
): void {
  const { id } = request
  try {
    if (request.verb === FALLBACK_RECYCLE_VERB) {
      const menu = native.buildFallback(request.paths)
      try {
        menu.recycle()
      } finally {
        menu.release()
      }
    } else {
      invokeVerbForTest(native, request.paths, request.verb)
    }
    post({ type: 'finished', id, ok: true })
  } catch (error) {
    post({ type: 'finished', id, ok: false, ...failureOf(error, 'invoke') })
  }
}

if (
  !isMainThread &&
  parentPort !== null &&
  (workerData as { storageiqShellWorker?: boolean } | null)?.storageiqShellWorker ===
    SHELL_WORKER_DATA.storageiqShellWorker
) {
  const port = parentPort
  const post: Post = (reply) => port.postMessage(reply)
  // The menu-less `invoke-verb` request exists for native tests only: the pool of a real app
  // never sets this flag, so the request is refused there.
  const testVerbs = (workerData as { testVerbs?: boolean }).testVerbs === true
  createWinShellNative().then(
    (native) => {
      port.on('message', (request: WorkerRequest) => {
        if (request.type === 'exit') {
          port.close()
          return
        }
        if (request.type === 'show') runShellRequest(native, request, post)
        else if (request.type === 'probe') runProbeRequest(native, request, post)
        // Test workers suppress Windows' UI for the Recycle Bin path only: FLAG_NO_UI makes the
        // verb ignore SHIFT_DOWN and recycle, so the permanent path runs with the real flags.
        else if (request.type === 'empty-bin') runEmptyBinRequest(native, request, post)
        else if (request.type === 'invoke-delete')
          runDeleteRequest(native, request, post, testVerbs && !request.permanent)
        else if (testVerbs) runInvokeVerbRequest(native, request, post)
        else
          post({ type: 'finished', id: request.id, ok: false, hresult: E_FAIL, step: 'disabled' })
      })
      // Only now may the main thread terminate this worker: koffi is loaded.
      post({ type: 'ready' })
    },
    (error: unknown) => {
      // Answer every request with a failure instead of leaving it pending.
      const { hresult, step } = failureOf(error, 'load')
      post({ type: 'ready' })
      port.on('message', (request: WorkerRequest) => {
        if (request.type === 'exit') port.close()
        else post({ type: 'failed', id: request.id, hresult, step })
      })
    },
  )
}
