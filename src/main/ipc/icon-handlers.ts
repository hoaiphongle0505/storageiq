import type { IconBatch, IconImage } from '@shared/ipc-contract'
import type { NodeId, TreeNodeDetails } from '@shared/tree-types'
import {
  folderKeyFor,
  iconKeyFor,
  isPerFileExtension,
  type NativeTarget,
  parseTypeKey,
  typeKeyOf,
} from '../icons/icon-keys'
import type { IconRequestResult } from '../icons/icon-service'
import type { IconWorkItem } from '../icons/icon-worker-protocol'
import { mapLimit } from './map-limit'
import { iconNodesArgs, iconTypesArgs } from './parse-args'
import type { IpcHandlerMap } from './register'
import type { TreeScanService } from './tree-handlers'

export type IconHandlers = Pick<IpcHandlerMap, 'icons:for-nodes' | 'icons:for-types'>

/** The part of the icon service the handlers use. */
export interface IconServiceLike {
  request(targets: readonly IconWorkItem[]): Promise<IconRequestResult>
  knownFolders(): Promise<ReadonlySet<string>>
  newScan(): void
}

/** Nodes resolved at the same time. */
const RESOLVE_IN_FLIGHT = 8

const isDriveRootPath = (target: string): boolean => /^[A-Za-z]:\\$/.test(target)

/** One row to answer: the key it shows, what to ask for, and what to show if that fails. */
interface Wanted {
  id: NodeId
  key: string
  target: NativeTarget
  /** The shared icon shown when the real lookup yields nothing (per-file and known folders). */
  fallback: IconWorkItem | null
  perFile: boolean
}

/**
 * Icons for the renderer: it names rows (`icons:for-nodes`, ids of the current scan) or shared
 * types (`icons:for-types`, a key such as `ext:txt`); main resolves every path from the scan
 * itself and never takes one from the renderer. A native failure answers with no images (the
 * rows keep their placeholder); only invalid arguments reject.
 */
export function createIconHandlers(deps: {
  scanService: TreeScanService
  icons: IconServiceLike
}): IconHandlers {
  const { scanService, icons } = deps
  let lastScanId: string | null = null

  const resolve = async (scanId: string, nodeId: NodeId): Promise<TreeNodeDetails | null> => {
    try {
      return await scanService.query({
        kind: 'node',
        scanId,
        nodeId,
        sortKey: 'size',
        sortDir: 'desc',
      })
    } catch {
      return null
    }
  }

  const request = async (targets: readonly IconWorkItem[]): Promise<IconRequestResult> => {
    if (targets.length === 0) return { images: {}, missing: [] }
    try {
      return await icons.request(targets)
    } catch {
      return { images: {}, missing: targets.map((target) => target.key) }
    }
  }

  const classify = (details: TreeNodeDetails, known: ReadonlySet<string>): Wanted | null => {
    const { row, path } = details
    if (row.kind === 'files') return null
    const typeKey = typeKeyOf(row, row.parentId === null && isDriveRootPath(path))
    const id = row.id
    if (typeKey === 'drive') {
      return {
        id,
        key: iconKeyFor('drive', path),
        target: { kind: 'path', path },
        fallback: null,
        perFile: false,
      }
    }
    if (typeKey === 'dir') {
      const key = folderKeyFor(path, known)
      if (key === 'dir') {
        return { id, key, target: { kind: 'dir' }, fallback: null, perFile: false }
      }
      return {
        id,
        key,
        target: { kind: 'path', path },
        fallback: { key: 'dir', target: { kind: 'dir' } },
        perFile: false,
      }
    }
    if (isPerFileExtension(typeKey)) {
      return {
        id,
        key: iconKeyFor(typeKey, path),
        target: { kind: 'path', path },
        fallback: { key: typeKey, target: parseTypeKey(typeKey) },
        perFile: true,
      }
    }
    return { id, key: typeKey, target: parseTypeKey(typeKey), fallback: null, perFile: false }
  }

  return {
    'icons:for-nodes': {
      parseArgs: iconNodesArgs,
      async handle(_event, scanId, nodeIds): Promise<IconBatch> {
        const batch: IconBatch = { keys: {}, images: {}, pending: [] }
        if (scanService.currentScan()?.scanId !== scanId) return batch
        if (scanId !== lastScanId) {
          // Per-file icons can change after a rescan: the service forgets them.
          lastScanId = scanId
          icons.newScan()
        }
        const nodes = await mapLimit([...new Set(nodeIds)], RESOLVE_IN_FLIGHT, (id) =>
          resolve(scanId, id),
        )
        const found = nodes.filter((node): node is TreeNodeDetails => node !== null)
        const needsKnown = found.some((node) => node.row.kind === 'folder')
        const known: ReadonlySet<string> = needsKnown
          ? await icons.knownFolders().catch(() => new Set<string>())
          : new Set<string>()
        const wanted = found.flatMap((node) => classify(node, known) ?? [])

        const unique = new Map<string, IconWorkItem>()
        for (const item of wanted) unique.set(item.key, { key: item.key, target: item.target })
        const first = await request([...unique.values()])
        Object.assign(batch.images, first.images)

        const fallbacks = new Map<string, IconWorkItem>()
        for (const item of wanted) {
          if (batch.images[item.key] === undefined && item.fallback !== null) {
            fallbacks.set(item.fallback.key, item.fallback)
          }
        }
        const second = await request([...fallbacks.values()])
        Object.assign(batch.images, second.images)

        for (const item of wanted) {
          const own = batch.images[item.key] !== undefined
          const fallback = item.fallback
          if (!own && fallback !== null && batch.images[fallback.key] !== undefined) {
            batch.keys[item.id] = fallback.key
            if (item.perFile) batch.pending.push(item.id)
          } else {
            batch.keys[item.id] = item.key
            if (!own && item.perFile) batch.pending.push(item.id)
          }
        }
        return batch
      },
    },
    'icons:for-types': {
      parseArgs: iconTypesArgs,
      async handle(_event, typeKeys): Promise<Record<string, IconImage>> {
        const targets = typeKeys.map((key) => ({ key, target: parseTypeKey(key) }))
        return (await request(targets)).images
      },
    },
  }
}
