import { lstat } from 'node:fs/promises'
import path from 'node:path'
import type { ContextMenuOutcome, CreateFolderResult } from '@shared/ipc-contract'
import { type NodeId, ROOT_NODE_ID, type TreeNodeDetails } from '@shared/tree-types'
import type { ShellMenuChoice } from '../shell-menu/context-menu'
import { nextNewFolderName } from '../shell-menu/menu-commands'
import { isShellPathGone } from '../shell-menu/win-shell-menu'
import type { ItemWatcher } from './item-watcher'
import { contextMenuArgs, scanNodeArgs } from './parse-args'
import type { IpcHandlerMap } from './register'
import {
  folderIdOf,
  type RefreshFolder,
  resolveScanNode,
  SCAN_RUNNING_MESSAGE,
  type TreeScanService,
} from './tree-handlers'

export type ShellHandlers = Pick<
  IpcHandlerMap,
  'shell:open-in-explorer' | 'shell:context-menu' | 'folder:create' | 'clipboard:copy-path'
>

/** For verbs that leave the item in place: the folder is rescanned once more after this delay. */
export const SECOND_REFRESH_DELAY_MS = 1500

/** Verbs after which the item may leave its folder, possibly well after InvokeCommand returns. */
const ITEM_LEAVING_VERBS: readonly (string | null)[] = ['delete', 'cut', 'rename', null]

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
  /** Shows the native Explorer menu at window CSS pixel `x`, `y` and runs the shell choice. */
  showShellMenu(target: string, x: number, y: number, extended: boolean): Promise<ShellMenuChoice>
  /** Whether the path still exists on disk (`fs.promises.lstat`). */
  pathExists(target: string): Promise<boolean>
  /** Polls for an item that a shell command is removing, and owns the delayed refresh timers. */
  watcher: ItemWatcher
  /** `console.warn`. */
  warn(message: string, error: unknown): void
}

export function createShellHandlers(deps: ShellHandlerDeps): ShellHandlers {
  const { scanService } = deps

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
    await deps.refreshFolder(scanId, parentId)
    return { parentId, name }
  }

  /** The folder to rescan after something happened to this item. */
  const containingFolder = (details: TreeNodeDetails): NodeId =>
    details.row.kind === 'folder'
      ? (details.ancestorIds.at(-1) ?? details.row.id)
      : folderIdOf(details)

  /** A refresh nobody awaits: a failure is logged, never thrown. */
  const refreshQuietly = (scanId: string, target: NodeId): void => {
    deps
      .refreshFolder(scanId, target)
      .catch((error: unknown) => deps.warn('Refresh after shell command failed', error))
  }

  /** The item no longer exists: rescan its folder so the stale row goes away. */
  const goneOutcome = (scanId: string, details: TreeNodeDetails): ContextMenuOutcome => {
    refreshQuietly(scanId, containingFolder(details))
    return { kind: 'gone' }
  }

  /** After a shell command that changed files: rescan now, and again once the change settles. */
  const refreshAfterShell = (
    scanId: string,
    details: TreeNodeDetails,
    verb: string | null,
  ): void => {
    const target = containingFolder(details)
    const key = `${scanId}:${details.row.id}`
    const isCurrent = () => scanService.currentScan()?.scanId === scanId
    // A root rescan is a full scan: never queue a second one.
    const isRoot = target === ROOT_NODE_ID
    if (ITEM_LEAVING_VERBS.includes(verb)) {
      if (!isRoot) refreshQuietly(scanId, target)
      deps.watcher.watch({
        key,
        itemPath: details.path,
        isCurrent,
        onSettled: () => refreshQuietly(scanId, target),
      })
      return
    }
    refreshQuietly(scanId, target)
    if (!isRoot) {
      deps.watcher.later({
        key,
        isCurrent,
        run: () => refreshQuietly(scanId, target),
        ms: SECOND_REFRESH_DELAY_MS,
      })
    }
  }

  return {
    'shell:open-in-explorer': {
      parseArgs: scanNodeArgs,
      handle: async (_event, scanId, nodeId) => {
        await openInExplorer(await resolveScanNode(scanService, scanId, nodeId))
      },
    },

    'shell:context-menu': {
      parseArgs: contextMenuArgs,
      handle: async (_event, scanId, nodeId, x, y, extended): Promise<ContextMenuOutcome> => {
        const details = await resolveScanNode(scanService, scanId, nodeId)
        if (!(await deps.pathExists(details.path))) return goneOutcome(scanId, details)
        let choice: ShellMenuChoice
        try {
          choice = await deps.showShellMenu(details.path, x, y, extended)
        } catch (error) {
          if (isShellPathGone(error)) return goneOutcome(scanId, details)
          throw error
        }
        if (choice.kind === 'dismissed') return { kind: 'dismissed' }
        if (choice.kind === 'shell') {
          if (choice.changed) refreshAfterShell(scanId, details, choice.verb)
          return { kind: 'shell', verb: choice.verb, changed: choice.changed }
        }
        switch (choice.item) {
          case 'refresh': {
            const refreshed = await deps.refreshFolder(scanId, folderIdOf(details))
            return { kind: 'refreshed', nodeId: refreshed?.row.id ?? folderIdOf(details) }
          }
          case 'copy-path':
            deps.writeClipboard(details.path)
            return { kind: 'copied' }
          case 'open':
            await openInExplorer(details)
            return { kind: 'opened' }
          case 'new-folder': {
            const created = await createFolder(scanId, details)
            return { kind: 'created', nodeId: created.parentId, name: created.name }
          }
        }
      },
    },

    'folder:create': {
      parseArgs: scanNodeArgs,
      handle: async (_event, scanId, nodeId) =>
        createFolder(scanId, await resolveScanNode(scanService, scanId, nodeId)),
    },

    'clipboard:copy-path': {
      parseArgs: scanNodeArgs,
      handle: async (_event, scanId, nodeId) => {
        deps.writeClipboard((await resolveScanNode(scanService, scanId, nodeId)).path)
      },
    },
  }
}
