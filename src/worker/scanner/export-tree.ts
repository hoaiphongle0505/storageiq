import { once } from 'node:events'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { finished } from 'node:stream/promises'
import { CSV_BOM, type Cell, csvLine } from '@shared/csv'
import { fileExtension } from '@shared/file-category'
import type { ExportFormat, ExportSummary } from '@shared/scanner-protocol'
import { AGE_COLUMNS, dateCell, TOP_FILES_COLUMNS, TYPES_COLUMNS } from '@shared/side-view-columns'
import type { NodeId } from '@shared/tree-types'
import type { SideViews } from './side-views'
import { folderOf, resolveNode } from './tree-queries'
import type { TreeStore } from './tree-store'
import { type SheetSpec, writeXlsx, XLSX_MAX_ROWS } from './xlsx-writer'

export const TREE_HEADER = [
  'Path',
  'Name',
  'Type',
  'Extension',
  'Size (bytes)',
  'Allocated (bytes)',
  'Files',
  'Folders',
  'Modified (UTC)',
  '% of parent',
] as const

interface Entry {
  isFolder: boolean
  index: number
  size: number
}

/** Children of a folder, biggest first; on a tie folders come before files, then scan order. */
function sortedEntries(store: TreeStore, folder: number): Entry[] {
  const entries: Entry[] = []
  for (const index of store.childFolders(folder)) {
    entries.push({ isFolder: true, index, size: store.folderSize(index) })
  }
  for (const index of store.filesIn(folder)) {
    entries.push({ isFolder: false, index, size: store.fileSize(index) })
  }
  return entries.sort(
    (a, b) => b.size - a.size || Number(b.isFolder) - Number(a.isFolder) || a.index - b.index,
  )
}

/** `path.join` for a folder path and one name, without its normalizing (a million calls). */
const child = (folderPath: string, name: string) =>
  folderPath.endsWith(path.sep) ? folderPath + name : folderPath + path.sep + name

/** One decimal, 0 to 100. */
const percent = (part: number, whole: number) =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0

/**
 * Every folder and file below `root`, depth first: a folder comes before its children, and the
 * children of each folder are in `sortedEntries` order. The root itself is not a row.
 */
export function* treeRows(store: TreeStore, root: number): Generator<Cell[]> {
  interface Frame {
    path: string
    size: number
    entries: Entry[]
    next: number
  }
  const frame = (folder: number, folderPath: string): Frame => ({
    path: folderPath,
    size: store.folderSize(folder),
    entries: sortedEntries(store, folder),
    next: 0,
  })
  const stack = [frame(root, store.folderPath(root))]
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const entry = top.entries[top.next]
    if (entry === undefined) {
      stack.pop()
      continue
    }
    top.next += 1
    if (entry.isFolder) {
      const name = store.folderName(entry.index)
      const folderPath = child(top.path, name)
      yield [
        folderPath,
        name,
        'Folder',
        '',
        entry.size,
        store.folderAllocated(entry.index),
        store.folderFiles(entry.index),
        store.folderFolders(entry.index),
        dateCell(store.folderModified(entry.index)),
        percent(entry.size, top.size),
      ]
      stack.push(frame(entry.index, folderPath))
    } else {
      const name = store.fileName(entry.index)
      yield [
        child(top.path, name),
        name,
        'File',
        fileExtension(name),
        entry.size,
        store.fileAllocated(entry.index),
        1,
        0,
        dateCell(store.fileModified(entry.index)),
        percent(entry.size, top.size),
      ]
    }
  }
}

/** Text is gathered to about this size before it is written. */
const BATCH_CHARS = 64 * 1024

/** What the user sees when the file cannot be written; anything else keeps the system's words. */
function friendlyError(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return new Error(
      'The file is open in another program, or StorageIQ is not allowed to write there.',
    )
  }
  if (code === 'ENOSPC') return new Error('There is not enough free space to save the file.')
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * Writes the whole tree below `nodeId` to `filePath`, streaming: a CSV (UTF-8 with a BOM, CRLF,
 * no row limit) or an Excel workbook (Tree, Top files, Types and Age sheets; the Tree sheet stops
 * at `maxRows`). Null when the node is gone. A file that could not be finished is deleted.
 */
export async function exportTree(
  store: TreeStore,
  views: SideViews,
  nodeId: NodeId,
  format: ExportFormat,
  filePath: string,
  maxRows = XLSX_MAX_ROWS,
): Promise<ExportSummary | null> {
  const ref = resolveNode(store, nodeId)
  if (ref === null) return null
  const folder = folderOf(store, ref)

  const out = createWriteStream(filePath)
  let opened = false
  let failure = null as Error | null
  // An error event with no listener would end the scanner process.
  out.on('error', (error) => {
    failure ??= error
  })
  const write = async (chunk: string | Buffer) => {
    if (failure !== null) throw failure
    if (!out.write(chunk)) await once(out, 'drain')
  }

  try {
    await once(out, 'open') // a file that is open elsewhere fails here, before any work
    opened = true
    let summary: ExportSummary
    if (format === 'csv') {
      await write(CSV_BOM + csvLine(TREE_HEADER))
      let batch = ''
      let rows = 0
      for (const row of treeRows(store, folder)) {
        batch += csvLine(row)
        rows += 1
        if (batch.length >= BATCH_CHARS) {
          await write(batch)
          batch = ''
        }
      }
      if (batch !== '') await write(batch)
      summary = { rows, truncated: false }
    } else {
      const sheets: SheetSpec[] = [
        {
          name: 'Tree',
          header: TREE_HEADER,
          widths: [70, 30, 8, 10, 14, 16, 8, 8, 20, 11],
          rows: treeRows(store, folder),
          maxRows,
        },
        {
          name: 'Top files',
          header: TOP_FILES_COLUMNS.header,
          widths: [32, 60, 14, 16, 20],
          rows: (views.topFiles(nodeId, 'size') ?? []).map((row) => TOP_FILES_COLUMNS.cells(row)),
        },
        {
          name: 'Types',
          header: TYPES_COLUMNS.header,
          widths: [18, 22, 14, 16, 10],
          rows: (views.types(nodeId) ?? []).map((row) => TYPES_COLUMNS.cells(row)),
        },
        {
          name: 'Age',
          header: AGE_COLUMNS.header,
          widths: [16, 14, 16, 10],
          rows: (views.age(nodeId) ?? []).map((row) => AGE_COLUMNS.cells(row)),
        },
      ]
      const [tree] = await writeXlsx(write, sheets)
      summary = { rows: tree?.rows ?? 0, truncated: tree?.truncated ?? false }
    }
    out.end()
    await finished(out)
    return summary
  } catch (error) {
    out.destroy()
    if (opened) {
      if (!out.closed) await once(out, 'close').catch(() => undefined)
      await rm(filePath, { force: true }).catch(() => undefined)
    }
    throw friendlyError(failure ?? error)
  }
}
