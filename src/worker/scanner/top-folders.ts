import type { FolderSummary } from '@shared/scan-types'
import type { FolderNode, ScanTree } from './tree'

export const TOP_FOLDER_LIMIT = 10
export const EVERYTHING_ELSE_LABEL = 'Everything else'

function largestFirst(a: FolderNode, b: FolderNode): number {
  if (b.bytes !== a.bytes) return b.bytes - a.bytes
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

/**
 * The direct children of the scanned root, largest first: the top `limit` folders plus one
 * "Everything else" row for the remaining folders and the files directly in the root.
 * (Ranking all folders would always put ancestors first; this list is the tree's first level.)
 */
export function topFolders(tree: ScanTree, limit = TOP_FOLDER_LIMIT): FolderSummary[] {
  const { root } = tree
  const top = [...root.children].sort(largestFirst).slice(0, limit)
  const rows: FolderSummary[] = top.map((node) => ({
    kind: 'folder',
    name: node.name,
    path: tree.pathOf(node),
    bytes: node.bytes,
    files: node.files,
    folders: node.folders,
  }))

  let bytes = root.bytes
  let files = root.files
  let folders = root.folders
  for (const node of top) {
    bytes -= node.bytes
    files -= node.files
    folders -= node.folders + 1
  }
  if (files > 0 || folders > 0) {
    rows.push({
      kind: 'everything-else',
      name: EVERYTHING_ELSE_LABEL,
      path: tree.rootPath,
      bytes,
      files,
      folders,
    })
  }
  return rows
}
