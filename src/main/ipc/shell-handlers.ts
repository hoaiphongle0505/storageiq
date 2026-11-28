import { lstat } from 'node:fs/promises'
import path from 'node:path'
import type { ContextMenuOutcome, CreateFolderResult } from '@shared/ipc-contract'
import { type NodeId, ROOT_NODE_ID, type TreeNodeDetails } from '@shared/tree-types'
import type {
  ShellFinish,
  ShellMenuChoice,
  ShellMenuHost,
  ShellMenuRequest,
} from '../shell-menu/context-menu'
import { nextNewFolderName } from '../shell-menu/menu-commands'
import { isDriveRoot, recycleBinRootOf } from '../shell-menu/recycle-bin'
import { E_FAIL, isShellPathGone } from '../shell-menu/shell-menu-error'
import { ShellBusyError } from '../shell-menu/shell-worker-pool'
import type { ItemWatcher } from './item-watcher'
import { mapLimit } from './map-limit'
import {
  contextMenuArgs,
  copyTextArgs,
  deleteArgs,
  scanNodeArgs,
  scanNodesArgs,
} from './parse-args'
import type { IpcHandlerMap } from './register'
import {
  folderIdOf,
  NOT_IN_SCAN_MESSAGE,
  type RefreshFolder,
  resolveScanNode,
  SCAN_RUNNING_MESSAGE,
  type TreeScanService,
} from './tree-handlers'

export type ShellHandlers = Pick<
  IpcHandlerMap,
  | 'shell:open-in-explorer'
  | 'shell:context-menu'
  | 'shell:delete'
  | 'folder:create'
  | 'clipboard:copy-path'
  | 'clipboard:copy-text'
>

/** For verbs that leave the item in place: the folder is rescanned once more after this delay. */
export const SECOND_REFRESH_DELAY_MS = 1500

/** Nodes resolved at the same time, and paths checked on disk at the same time. */
const RESOLVE_IN_FLIGHT = 8
const EXISTS_IN_FLIGHT = 16
/** More affected folders than this are replaced by their deepest common ancestor. */
const MAX_REFRESH_FOLDERS = 50

/** Verbs after which the item may leave its folder, possibly well after InvokeCommand returns. */
const WATCHED_VERBS: readonly (string | null)[] = ['cut', 'rename', null]

/**
 * Whether `target` exists. Only a missing path (ENOENT, ENOTDIR) is reported as absent: any other
 * error (a permission problem) keeps the item, so a live item is never reported as gone.
 */
export async function itemExists(target: string): Promise<boolean> {
  try {
    await lstat(target)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code
    return !(code === 'ENOENT' || code === 'ENOTDIR')
  }
}

export interface ShellHandlerDeps {
  scanService: TreeScanService
  refreshFolder: RefreshFolder
  /** `shell.openPath`: resolves with an error message, or `''` on success. */
  openPath(target: string): Promise<string>
  /** `shell.showItemInFolder`. */
  showItemInFolder(target: string): void
  /** `clipboard.writeText`. */
  writeClipboard(text: string): void
  readdir(folder: string): Promise<string[]>
  mkdir(folder: string): Promise<void>
  /**
   * Starts the native Explorer menu for the request (x, y in window CSS pixels; `index.ts`
   * converts them to screen pixels). Throws `ShellBusyError` when three actions already run.
   */
  showShellMenu(request: ShellMenuRequest): ReturnType<ShellMenuHost['show']>
  /**
   * Starts the shell's `"delete"` verb for the paths (Shift+Delete when `permanent`) on a worker
   * thread. Throws `ShellBusyError` when three actions already run.
   */
  deleteShellItems(paths: string[], permanent: boolean): ReturnType<ShellMenuHost['deleteItems']>
  /** Empties a drive's Recycle Bin (`SHEmptyRecycleBinW`); throws `ShellBusyError` when busy. */
  emptyRecycleBin(root: string): ReturnType<ShellMenuHost['emptyRecycleBin']>
  /** The current user's SID (the name of their folder in `$RECYCLE.BIN`), or null when unknown. */
  userSid(): Promise<string | null>
  /** `fs.realpath.native`: the real path (SUBST drives and junctions resolved); rejects if unreadable. */
  realPath(target: string): Promise<string>
  /** Whether the path still exists on disk (`fs.promises.lstat`). */
  pathExists(target: string): Promise<boolean>
  /** Polls for items that a shell command is removing, and owns the delayed refresh timers. */
  watcher: ItemWatcher
  /** `console.warn`. */
  warn(message: string, error: unknown): void
}

/** The folder ids from the root down to (and including) `last` for an item. */
function folderChain(details: TreeNodeDetails, ownFolder: boolean): NodeId[] {
  const chain = details.ancestorIds.filter((id) => id.startsWith('d'))
  if (ownFolder && details.row.kind === 'folder') return [...chain, details.row.id]
  return chain.length === 0 ? [details.row.id] : chain
}

/** The folder to rescan after something happened to this item. */
function containingFolder(details: TreeNodeDetails): NodeId {
  return details.row.kind === 'folder'
    ? (details.ancestorIds.at(-1) ?? details.row.id)
    : folderIdOf(details)
}

const isDriveRootPath = (target: string): boolean => /^[A-Za-z]:\\?$/.test(target)

export function createShellHandlers(deps: ShellHandlerDeps): ShellHandlers {
  const { scanService } = deps
  /** Counts actions, so timers and watches of two actions never share a key. */
  let actionSeq = 0

  const isCurrentScan = (scanId: string): boolean => scanService.currentScan()?.scanId === scanId

  // ---- refreshes -------------------------------------------------------------------------

  /** One job per folder, one at a time: a rescan of the same folder never runs twice at once. */
  interface RefreshJob {
    scanId: string
    nodeId: NodeId
    waiters: Array<{
      resolve(details: Awaited<ReturnType<RefreshFolder>>): void
      reject(error: unknown): void
    }>
  }
  const refreshQueue: RefreshJob[] = []
  let draining = false

  const drainRefreshes = async (): Promise<void> => {
    if (draining) return
    draining = true
    try {
      for (let job = refreshQueue.shift(); job !== undefined; job = refreshQueue.shift()) {
        if (!isCurrentScan(job.scanId)) {
          for (const waiter of job.waiters) waiter.resolve(null)
          continue
        }
        try {
          const details = await deps.refreshFolder(job.scanId, job.nodeId)
          for (const waiter of job.waiters) waiter.resolve(details)
        } catch (error) {
          for (const waiter of job.waiters) waiter.reject(error)
        }
      }
    } finally {
      draining = false
    }
  }

  /** Queues a refresh of one folder (a folder already waiting in the queue is not queued twice). */
  const enqueueRefresh = (scanId: string, nodeId: NodeId): ReturnType<RefreshFolder> =>
    new Promise((resolve, reject) => {
      const waiting = refreshQueue.find((job) => job.scanId === scanId && job.nodeId === nodeId)
      if (waiting) waiting.waiters.push({ resolve, reject })
      else refreshQueue.push({ scanId, nodeId, waiters: [{ resolve, reject }] })
      void drainRefreshes()
    })

  /** A refresh nobody awaits: a failure is logged, never thrown. */
  const refreshQuietly = (scanId: string, target: NodeId): void => {
    enqueueRefresh(scanId, target).catch((error: unknown) =>
      deps.warn('Refresh after shell command failed', error),
    )
  }

  /**
   * The folders to rescan for these items: their distinct containing folders, or their deepest
   * common ancestor when there are more than 50.
   */
  const refreshTargets = (items: readonly TreeNodeDetails[], ownFolder = false): NodeId[] => {
    const folderOf = ownFolder ? folderIdOf : containingFolder
    const parents = [...new Set(items.map(folderOf))]
    if (parents.length <= MAX_REFRESH_FOLDERS) return parents
    const chains = items.map((item) => folderChain(item, ownFolder))
    const first = chains[0] ?? [ROOT_NODE_ID]
    let depth = first.length
    for (const chain of chains) {
      let common = 0
      while (common < depth && chain[common] === first[common]) common += 1
      depth = common
    }
    return [first[Math.max(0, depth - 1)] ?? ROOT_NODE_ID]
  }

  /**
   * After items may have gone: rescan their folders (rule: one `tree:changed` per folder). A root
   * rescan is a full scan, so it runs once, and with `needGone` only when a root-level item no
   * longer exists. `skipRoot` leaves the root out (a timed-out watch, or a root rescan that
   * already ran). Resolves with whether the root was rescanned.
   */
  const refreshAffected = async (
    scanId: string,
    items: readonly TreeNodeDetails[],
    options: { needGone: boolean; skipRoot?: boolean },
  ): Promise<boolean> => {
    if (!isCurrentScan(scanId)) return false
    const targets = refreshTargets(items)
    if (targets.includes(ROOT_NODE_ID)) {
      if (options.skipRoot) return false
      let rescan = !options.needGone
      if (options.needGone) {
        const rootItems = items.filter((item) => containingFolder(item) === ROOT_NODE_ID)
        const gone = await mapLimit(rootItems, EXISTS_IN_FLIGHT, async (item) =>
          deps.pathExists(item.path).then(
            (exists) => !exists,
            () => false,
          ),
        )
        rescan = gone.some(Boolean)
      }
      // A root rescan replaces the whole scan, so the folder refreshes would be wasted.
      if (rescan) refreshQuietly(scanId, ROOT_NODE_ID)
      else for (const target of targets) if (target !== ROOT_NODE_ID) refreshQuietly(scanId, target)
      return rescan
    }
    for (const target of targets) refreshQuietly(scanId, target)
    return false
  }

  // ---- shell commands that keep running ----------------------------------------------------

  /**
   * Continues after the menu closed, per verb class. Nothing here is awaited by the IPC call and
   * nothing throws: failures are logged.
   */
  const continueAfterShell = (
    scanId: string,
    items: readonly TreeNodeDetails[],
    verb: string | null,
    finished: Promise<ShellFinish>,
    /** The items are Recycle Bin folders that were emptied: refresh those folders themselves. */
    refreshOwn = false,
  ): void => {
    const seq = (actionSeq += 1)
    const key = `${scanId}:${seq}`
    const isCurrent = () => isCurrentScan(scanId)
    const later = (run: () => void): void =>
      deps.watcher.later({ key, isCurrent, run, ms: SECOND_REFRESH_DELAY_MS })
    const quiet = (promise: Promise<boolean>): Promise<boolean> =>
      promise.catch((error: unknown) => {
        deps.warn('Refresh after shell command failed', error)
        return false
      })

    if (verb === 'delete' && refreshOwn) {
      void finished
        .catch((): ShellFinish => ({ ok: false, hresult: 0, step: 'finished' }))
        .then((result) => {
          if (!result.ok) {
            deps.warn(
              'Emptying the Recycle Bin did not finish cleanly',
              new Error(`${result.step} (0x${result.hresult.toString(16)})`),
            )
          }
          const targets = refreshTargets(items, true)
          for (const target of targets) refreshQuietly(scanId, target)
          later(() => {
            for (const target of targets) refreshQuietly(scanId, target)
          })
        })
      return
    }

    if (verb === 'delete') {
      // The shell runs the copy engine inside InvokeCommand (on the worker): wait for it, then
      // refresh once even after a failure or Cancel, because some items may already be gone.
      void finished
        .catch((): ShellFinish => ({ ok: false, hresult: 0, step: 'finished' }))
        .then((result) => {
          if (!result.ok) {
            deps.warn(
              'Shell delete did not finish cleanly',
              new Error(`${result.step} (0x${result.hresult.toString(16)})`),
            )
          }
          void quiet(refreshAffected(scanId, items, { needGone: true })).then((rootRescanned) =>
            later(() => {
              void quiet(
                refreshAffected(scanId, items, { needGone: true, skipRoot: rootRescanned }),
              )
            }),
          )
        })
      return
    }

    if (WATCHED_VERBS.includes(verb)) {
      // Cut, rename and unknown commands: the items leave some time later, and no signal says when.
      deps.watcher.watchMany({
        key,
        itemPaths: items.map((item) => item.path),
        isCurrent,
        // A root item that is still there after the timeout means the command was cancelled: a
        // root refresh is a full rescan, so it is skipped. Deeper folders refresh cheaply.
        onSettled: (reason) => {
          void quiet(
            refreshAffected(scanId, items, { needGone: true, skipRoot: reason === 'timeout' }),
          )
        },
      })
      return
    }

    // Paste, new item, shortcut, third-party commands: the items stay, only the folder changes.
    void quiet(refreshAffected(scanId, items, { needGone: false }))
    later(() => {
      void quiet(refreshAffected(scanId, items, { needGone: false, skipRoot: true }))
    })
  }

  // ---- node helpers ------------------------------------------------------------------------

  const openInExplorer = async (details: TreeNodeDetails): Promise<void> => {
    if (details.row.kind === 'file') {
      deps.showItemInFolder(details.path)
      return
    }
    const problem = await deps.openPath(details.path)
    if (problem !== '') throw new Error(problem)
  }

  const createFolder = async (
    scanId: string,
    details: TreeNodeDetails,
  ): Promise<CreateFolderResult> => {
    if (scanService.isScanning()) throw new Error(SCAN_RUNNING_MESSAGE)
    const parentId = folderIdOf(details)
    const folderPath = details.row.kind === 'file' ? path.win32.dirname(details.path) : details.path
    const name = nextNewFolderName(await deps.readdir(folderPath))
    await deps.mkdir(path.win32.join(folderPath, name))
    await enqueueRefresh(scanId, parentId)
    return { parentId, name }
  }

  /**
   * Looks the rows up in the current scan (ids deduplicated, request order kept). A row that no
   * longer exists is dropped; any other failure (another scan, a dead scanner) is thrown.
   */
  const resolveNodes = async (
    scanId: string,
    nodeIds: readonly NodeId[],
  ): Promise<TreeNodeDetails[]> => {
    if (!isCurrentScan(scanId)) throw new Error(NOT_IN_SCAN_MESSAGE)
    const unique = [...new Set(nodeIds)]
    const resolved = await mapLimit(unique, RESOLVE_IN_FLIGHT, async (id) => {
      try {
        return await resolveScanNode(scanService, scanId, id)
      } catch (error) {
        if (
          isCurrentScan(scanId) &&
          error instanceof Error &&
          error.message === NOT_IN_SCAN_MESSAGE
        )
          return null
        throw error
      }
    })
    return resolved.filter((details): details is TreeNodeDetails => details !== null)
  }

  /** With several rows: no root, no "[N files]" rows, no row inside another selected row. */
  const actionable = (items: TreeNodeDetails[]): TreeNodeDetails[] => {
    if (items.length <= 1) return items
    const rows = items.filter((item) => item.row.id !== ROOT_NODE_ID && item.row.kind !== 'files')
    const selected = new Set(rows.map((item) => item.row.id))
    return rows.filter((item) => !item.ancestorIds.some((id) => selected.has(id)))
  }

  /** Drops items that vanished from disk (their folders are refreshed quietly). */
  const existingOnly = async (
    scanId: string,
    items: readonly TreeNodeDetails[],
  ): Promise<TreeNodeDetails[]> => {
    const present = await mapLimit(items, EXISTS_IN_FLIGHT, (item) => deps.pathExists(item.path))
    const kept = items.filter((_, index) => present[index] === true)
    const missing = items.filter((_, index) => present[index] !== true)
    for (const target of refreshTargets(missing)) refreshQuietly(scanId, target)
    return kept
  }

  /** Starts the menu; `ShellBusyError` (thrown or rejected) becomes `null`. */
  const startMenu = (request: ShellMenuRequest): ReturnType<ShellMenuHost['show']> | null => {
    try {
      return deps.showShellMenu(request)
    } catch (error) {
      if (error instanceof ShellBusyError) return null
      throw error
    }
  }

  const contextMenu = async (
    scanId: string,
    nodeIds: readonly NodeId[],
    x: number,
    y: number,
    extended: boolean,
  ): Promise<ContextMenuOutcome> => {
    const resolved = await resolveNodes(scanId, nodeIds)
    if (resolved.length === 0) return { kind: 'gone' }
    // A single request keeps today's behaviour for any row, the root and group rows included.
    let items = actionable(resolved)
    if (items.length === 0) return { kind: 'dismissed' }
    items = await existingOnly(scanId, items)
    if (items.length === 0) return { kind: 'gone' }

    const hideDestructive =
      resolved.length === 1 &&
      items.length === 1 &&
      (items[0]?.row.id === ROOT_NODE_ID || isDriveRootPath(items[0]?.path ?? ''))

    // A menu that fails because an item vanished meanwhile is retried once with the rest.
    let shown = startMenu({ paths: items.map((i) => i.path), x, y, extended, hideDestructive })
    if (shown === null) return { kind: 'busy' }
    let choice: ShellMenuChoice
    try {
      choice = await shown.chosen
    } catch (error) {
      if (!isShellPathGone(error)) throw error
      const remaining = await existingOnly(scanId, items)
      if (remaining.length === 0 || remaining.length === items.length) {
        // Nothing vanished that we can see (or everything did): the list is stale either way.
        for (const target of refreshTargets(items)) refreshQuietly(scanId, target)
        return { kind: 'gone' }
      }
      items = remaining
      shown = startMenu({ paths: items.map((i) => i.path), x, y, extended, hideDestructive })
      if (shown === null) return { kind: 'busy' }
      try {
        choice = await shown.chosen
      } catch (retryError) {
        if (!isShellPathGone(retryError)) throw retryError
        return { kind: 'gone' }
      }
    }

    const count = items.length
    const first = items[0]
    if (choice.kind === 'dismissed' || first === undefined) return { kind: 'dismissed' }

    if (choice.kind === 'shell') {
      if (choice.changed) continueAfterShell(scanId, items, choice.verb, shown.finished)
      // The IPC call never waits for the command: it is still running in Windows right now.
      return { kind: 'shell', verb: choice.verb, changed: choice.changed, count, running: true }
    }

    switch (choice.item) {
      case 'refresh': {
        const targets = refreshTargets(items, true)
        const results = await Promise.all(targets.map((target) => enqueueRefresh(scanId, target)))
        const target = targets[0] ?? folderIdOf(first)
        return { kind: 'refreshed', nodeId: results[0]?.row.id ?? target }
      }
      case 'copy-path':
        deps.writeClipboard(items.map((item) => item.path).join('\r\n'))
        return { kind: 'copied', count }
      case 'open':
        if (count !== 1) return { kind: 'dismissed' }
        await openInExplorer(first)
        return { kind: 'opened' }
      case 'new-folder': {
        if (count !== 1) return { kind: 'dismissed' }
        const created = await createFolder(scanId, first)
        return { kind: 'created', nodeId: created.parentId, name: created.name }
      }
      case 'delete':
        // Only the fallback menu has this item, and its choice is reported as a shell verb.
        return { kind: 'dismissed' }
    }
  }

  /**
   * Keyboard Delete / Shift+Delete. The same resolution as the context menu, but the root, the
   * "[N files]" rows and drive roots are never deleted, not even alone (a "[N files]" row's path
   * is its folder). Rows leave the tree through the same refresh as a menu delete.
   */
  const deleteNodes = async (
    scanId: string,
    nodeIds: readonly NodeId[],
    permanent: boolean,
  ): Promise<ContextMenuOutcome> => {
    if (scanService.isScanning()) throw new Error(SCAN_RUNNING_MESSAGE)
    const resolved = await resolveNodes(scanId, nodeIds)
    if (resolved.length === 0) return { kind: 'gone' }
    const rows = resolved.filter(
      (item) =>
        item.row.id !== ROOT_NODE_ID && item.row.kind !== 'files' && !isDriveRootPath(item.path),
    )
    let items = actionable(rows)
    if (items.length === 0) return { kind: 'dismissed' }
    items = await existingOnly(scanId, items)
    if (items.length === 0) return { kind: 'gone' }
    // A drive's `$RECYCLE.BIN` or the current user's folder in it is emptied with Windows' own
    // call: the delete verb would walk every item in it. Only those two shapes, and only when the
    // real path (SUBST and junctions resolved) is the same bin on the same drive.
    const userSid = await deps.userSid().catch(() => null)
    const binRoots = await Promise.all(
      items.map(async (item): Promise<string | null> => {
        if (item.row.kind !== 'folder') return null
        const root = recycleBinRootOf(item.path, userSid)
        if (root === null) return null
        const real = await deps.realPath(item.path).then(
          (resolved) => resolved,
          () => null,
        )
        return real !== null && recycleBinRootOf(real, userSid) === root ? root : null
      }),
    )
    const bins = items.filter((_, index) => binRoots[index] !== null)
    if (bins.length > 0 && bins.length < items.length) return { kind: 'bin-mixed' }
    let finished: Promise<ShellFinish>
    try {
      if (bins.length > 0) {
        const roots = [
          ...new Set(binRoots.filter((root): root is string => root !== null && isDriveRoot(root))),
        ]
        const first = roots.length === 0 ? null : deps.emptyRecycleBin(roots[0] as string)
        if (first === null) return { kind: 'dismissed' }
        // One call per drive, one after the other, and on to the next drive after a failure.
        finished = (async (): Promise<ShellFinish> => {
          let failure: ShellFinish | null = null
          const note = (result: ShellFinish) => {
            if (!result.ok && failure === null) failure = result
          }
          note(
            await first.catch((): ShellFinish => ({ ok: false, hresult: E_FAIL, step: 'empty' })),
          )
          for (const root of roots.slice(1)) {
            try {
              note(await deps.emptyRecycleBin(root))
            } catch {
              note({ ok: false, hresult: E_FAIL, step: 'empty' })
            }
          }
          return failure ?? { ok: true }
        })()
      } else {
        finished = deps.deleteShellItems(
          items.map((item) => item.path),
          permanent,
        )
      }
    } catch (error) {
      if (error instanceof ShellBusyError) return { kind: 'busy' }
      throw error
    }
    continueAfterShell(scanId, items, 'delete', finished, bins.length > 0)
    return { kind: 'shell', verb: 'delete', changed: true, count: items.length, running: true }
  }

  return {
    'shell:delete': {
      parseArgs: deleteArgs,
      handle: (_event, scanId, nodeIds, permanent) => deleteNodes(scanId, nodeIds, permanent),
    },

    'shell:open-in-explorer': {
      parseArgs: scanNodeArgs,
      handle: async (_event, scanId, nodeId) => {
        await openInExplorer(await resolveScanNode(scanService, scanId, nodeId))
      },
    },

    'shell:context-menu': {
      parseArgs: contextMenuArgs,
      handle: (_event, scanId, nodeIds, x, y, extended) =>
        contextMenu(scanId, nodeIds, x, y, extended),
    },

    'folder:create': {
      parseArgs: scanNodeArgs,
      handle: async (_event, scanId, nodeId) =>
        createFolder(scanId, await resolveScanNode(scanService, scanId, nodeId)),
    },

    'clipboard:copy-path': {
      parseArgs: scanNodesArgs,
      handle: async (_event, scanId, nodeIds) => {
        const items = await resolveNodes(scanId, nodeIds)
        if (items.length === 0) throw new Error(NOT_IN_SCAN_MESSAGE)
        deps.writeClipboard([...new Set(items.map((item) => item.path))].join('\r\n'))
      },
    },

    // The text is the renderer's own (a CSV it built from a scanner list), so unlike
    // `clipboard:copy-path` there is no node to resolve; the length limit is in `copyTextArgs`.
    'clipboard:copy-text': {
      parseArgs: copyTextArgs,
      handle: (_event, text) => {
        deps.writeClipboard(text)
      },
    },
  }
}
