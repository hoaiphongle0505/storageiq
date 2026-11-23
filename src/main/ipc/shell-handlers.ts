import path from 'node:path'
import type { ContextMenuOutcome, CreateFolderResult } from '@shared/ipc-contract'
import type { NodeId, TreeNodeDetails } from '@shared/tree-types'
import type { ShellMenuChoice } from '../shell-menu/context-menu'
import { nextNewFolderName } from '../shell-menu/menu-commands'
import { clipboardArgs, contextMenuArgs, scanNodeArgs } from './parse-args'
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
  'shell:open-in-explorer' | 'shell:context-menu' | 'folder:create' | 'clipboard:write-text'
>

/** A shell command may finish after InvokeCommand returns (a delete with a progress dialog). */
export const SECOND_REFRESH_DELAY_MS = 1500

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
  /** `setTimeout`, injectable for tests. */
  later(callback: () => void, ms: number): void
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

  /** After a shell command that may change the disk: rescan the item's folder, twice. */
  const refreshAfterShell = (scanId: string, details: TreeNodeDetails): void => {
    const target: NodeId =
      details.row.kind === 'folder'
        ? (details.ancestorIds.at(-1) ?? details.row.id)
        : folderIdOf(details)
    const refresh = () => {
      deps.refreshFolder(scanId, target).catch(() => undefined)
    }
    refresh()
    deps.later(refresh, SECOND_REFRESH_DELAY_MS)
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
        const choice = await deps.showShellMenu(details.path, x, y, extended)
        if (choice.kind === 'dismissed') return { kind: 'dismissed' }
        if (choice.kind === 'shell') {
          if (choice.changed) refreshAfterShell(scanId, details)
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

    'clipboard:write-text': {
      parseArgs: clipboardArgs,
      handle: (_event, text) => {
        deps.writeClipboard(text)
      },
    },
  }
}
