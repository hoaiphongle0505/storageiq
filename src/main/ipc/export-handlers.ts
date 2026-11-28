import path from 'node:path'
import type { BrowserWindow, SaveDialogOptions, SaveDialogReturnValue } from 'electron'
import type { ExportResult } from '@shared/ipc-contract'
import type { ExportFormat } from '@shared/scanner-protocol'
import { exportArgs, noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'
import {
  NOT_IN_SCAN_MESSAGE,
  resolveScanNode,
  SCAN_RUNNING_MESSAGE,
  type TreeScanService,
} from './tree-handlers'

export type ExportHandlers = Pick<IpcHandlerMap, 'export:run' | 'shell:show-export'>

export const EXPORT_RUNNING_MESSAGE = 'An export is already running.'

export interface ExportHandlerDeps {
  scanService: TreeScanService
  dialog: {
    showSaveDialog(
      window: BrowserWindow,
      options: SaveDialogOptions,
    ): Promise<SaveDialogReturnValue>
  }
  getMainWindow(): BrowserWindow | null
  /** Where the save dialog opens (the Documents folder). */
  defaultFolder(): string
  /** `shell.showItemInFolder`. */
  showItemInFolder(target: string): void
}

const FILTERS: Record<
  ExportFormat,
  { title: string; filter: { name: string; extensions: string[] } }
> = {
  csv: { title: 'Export to CSV', filter: { name: 'CSV file', extensions: ['csv'] } },
  xlsx: { title: 'Export to Excel', filter: { name: 'Excel workbook', extensions: ['xlsx'] } },
}

/** `<folder name> - StorageIQ.csv`, without characters Windows does not allow in a file name. */
export function exportFileName(folderName: string, format: ExportFormat): string {
  const base = folderName.replace(/[\\/:*?"<>|]/g, '').trim()
  return `${base === '' ? 'Export' : base} - StorageIQ.${format}`
}

/**
 * Exports the folder's tree to a file. The renderer sends only (scan id, node id, format): the file
 * is chosen in main's save dialog and written by the scanner, so no path ever comes from the
 * renderer. Remembers the last file written so "Show in folder" can open it.
 */
export function createExportHandlers(deps: ExportHandlerDeps): ExportHandlers {
  const { scanService } = deps
  let running = false
  let lastExport: string | null = null

  const failed = (error: unknown): ExportResult => ({
    status: 'failed',
    message: error instanceof Error ? error.message : String(error),
  })

  return {
    'export:run': {
      parseArgs: exportArgs,
      handle: async (_event, scanId, nodeId, format): Promise<ExportResult> => {
        if (running) return { status: 'failed', message: EXPORT_RUNNING_MESSAGE }
        if (scanService.isScanning()) return { status: 'failed', message: SCAN_RUNNING_MESSAGE }
        running = true
        try {
          const details = await resolveScanNode(scanService, scanId, nodeId)
          const window = deps.getMainWindow()
          if (window === null) return { status: 'cancelled' }
          const { title, filter } = FILTERS[format]
          const name = exportFileName(details.row.kind === 'folder' ? details.row.name : '', format)
          const chosen = await deps.dialog.showSaveDialog(window, {
            title,
            defaultPath: path.join(deps.defaultFolder(), name),
            filters: [filter],
          })
          if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' }
          const summary = await scanService.query({
            kind: 'export',
            scanId,
            nodeId,
            format,
            filePath: chosen.filePath,
          })
          if (summary === null) return { status: 'failed', message: NOT_IN_SCAN_MESSAGE }
          lastExport = chosen.filePath
          return { status: 'done', filePath: chosen.filePath, ...summary }
        } catch (error) {
          return failed(error)
        } finally {
          running = false
        }
      },
    },

    'shell:show-export': {
      parseArgs: noArgs,
      handle: () => {
        if (lastExport !== null) deps.showItemInFolder(lastExport)
      },
    },
  }
}
