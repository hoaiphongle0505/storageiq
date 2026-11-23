import { type NodeId, ROOT_NODE_ID, type TreeNodeDetails } from '@shared/tree-types'
import type { ScanVolume } from '@shared/scanner-protocol'
import type { ScanService } from '../scan/scan-service'
import { childrenArgs, expandArgs, nodeArgs, scanNodeArgs, treemapArgs } from './parse-args'
import type { IpcHandlerMap } from './register'
import type { SendEvent } from './send-event'

export type TreeHandlers = Pick<
  IpcHandlerMap,
  'tree:children' | 'tree:node' | 'tree:expand-ids' | 'tree:refresh' | 'treemap:layout'
>

export const NOT_IN_SCAN_MESSAGE = 'That item is not part of the current scan.'
export const SCAN_RUNNING_MESSAGE = 'Wait for the scan to finish, then try again.'

export type TreeScanService = Pick<ScanService, 'query' | 'currentScan' | 'isScanning' | 'start'>

/**
 * Looks a node up in the current scan. Used before any action that touches the disk or the
 * clipboard: the path must come from the scanner's tree, never from the renderer.
 */
export async function resolveScanNode(
  scanService: TreeScanService,
  scanId: string,
  nodeId: NodeId,
): Promise<TreeNodeDetails> {
  if (scanService.currentScan()?.scanId !== scanId) throw new Error(NOT_IN_SCAN_MESSAGE)
  const details = await scanService.query({
    kind: 'node',
    scanId,
    nodeId,
    sortKey: 'size',
    sortDir: 'desc',
  })
  if (details === null) throw new Error(NOT_IN_SCAN_MESSAGE)
  return details
}

/** The folder a row belongs to: a folder itself, the folder of "[N files]", a file's folder. */
export function folderIdOf(details: TreeNodeDetails): NodeId {
  const { row } = details
  if (row.kind === 'folder') return row.id
  if (row.kind === 'files') return `d${row.id.slice(1)}`
  const group = row.parentId ?? 'g0'
  return `d${group.slice(1)}`
}

export type RefreshFolder = (scanId: string, nodeId: NodeId) => Promise<TreeNodeDetails | null>

/** Rescans a folder in the scanner, then tells the renderer with `tree:changed`. */
export function createFolderRefresher(
  scanService: TreeScanService,
  sendEvent: SendEvent,
  volumeFor: (root: string) => Promise<ScanVolume>,
): RefreshFolder {
  return async (scanId, nodeId) => {
    if (scanService.currentScan()?.scanId !== scanId) throw new Error(NOT_IN_SCAN_MESSAGE)
    if (scanService.isScanning()) throw new Error(SCAN_RUNNING_MESSAGE)
    const target = await scanService.query({
      kind: 'node',
      scanId,
      nodeId,
      sortKey: 'size',
      sortDir: 'desc',
    })
    if (target === null) return null
    if (folderIdOf(target) === ROOT_NODE_ID) {
      // The whole scan root is a normal scan (progress, cancel, isScanning), not a hidden refresh.
      const root = scanService.currentScan()?.root
      if (root === undefined) throw new Error(NOT_IN_SCAN_MESSAGE)
      const started = scanService.start(root, await volumeFor(root)) // fresh free space, like scan:start
      sendEvent('scan:restarted', { scanId: started.scanId, root })
      return null
    }
    const details = await scanService.query({ kind: 'refresh', scanId, nodeId })
    if (details === null) return null
    const totals = await scanService.query({ kind: 'totals', scanId })
    if (totals !== null) sendEvent('tree:changed', { scanId, nodeId: details.row.id, totals })
    return details
  }
}

export function createTreeHandlers(deps: {
  scanService: TreeScanService
  refreshFolder: RefreshFolder
}): TreeHandlers {
  const { scanService } = deps
  return {
    'tree:children': {
      parseArgs: childrenArgs,
      handle: (_event, scanId, nodeId, sortKey, sortDir, offset, limit) =>
        scanService.query({ kind: 'children', scanId, nodeId, sortKey, sortDir, offset, limit }),
    },
    'tree:node': {
      parseArgs: nodeArgs,
      handle: (_event, scanId, nodeId, sortKey, sortDir) =>
        scanService.query({ kind: 'node', scanId, nodeId, sortKey, sortDir }),
    },
    'tree:expand-ids': {
      parseArgs: expandArgs,
      handle: (_event, scanId, nodeId, levels) =>
        scanService.query({ kind: 'expand', scanId, nodeId, levels }),
    },
    'tree:refresh': {
      parseArgs: scanNodeArgs,
      handle: (_event, scanId, nodeId) => deps.refreshFolder(scanId, nodeId),
    },
    'treemap:layout': {
      parseArgs: treemapArgs,
      handle: (_event, scanId, nodeId, mode, depth, width, height) =>
        scanService.query({ kind: 'treemap', scanId, nodeId, mode, depth, width, height }),
    },
  }
}
