import { type AboutLink, MAX_CLIPBOARD_TEXT } from '@shared/ipc-contract'
import { EXPORT_FORMATS, type ExportFormat } from '@shared/scanner-protocol'
import {
  MAX_PAGE_ROWS,
  MAX_TREEMAP_DEPTH,
  NODE_ID_PATTERN,
  SIZE_MODES,
  SORT_KEYS,
  type NodeId,
  type SizeMode,
  type SortDir,
  type SortKey,
} from '@shared/tree-types'

/** Thrown by `parseArgs` when the renderer sent malformed arguments; the handler never runs. */
export class InvalidIpcArgumentsError extends Error {
  constructor(reason: string) {
    super(`Invalid IPC arguments: ${reason}`)
    this.name = 'InvalidIpcArgumentsError'
  }
}

/** `parseArgs` for channels that take no arguments. */
export function noArgs(args: readonly unknown[]): [] {
  if (args.length !== 0) {
    throw new InvalidIpcArgumentsError(`expected no arguments, got ${args.length}`)
  }
  return []
}

/** `parseArgs` for channels that take exactly one string. */
export function oneString(args: readonly unknown[]): [string] {
  if (args.length !== 1) {
    throw new InvalidIpcArgumentsError(`expected 1 argument, got ${args.length}`)
  }
  const [value] = args
  if (typeof value !== 'string') {
    throw new InvalidIpcArgumentsError(`expected a string, got ${typeof value}`)
  }
  return [value]
}

/** `parseArgs` for channels that take exactly one boolean (no truthy numbers or strings). */
export function oneBoolean(args: readonly unknown[]): [boolean] {
  if (args.length !== 1) {
    throw new InvalidIpcArgumentsError(`expected 1 argument, got ${args.length}`)
  }
  const [value] = args
  if (typeof value !== 'boolean') {
    throw new InvalidIpcArgumentsError(`expected true or false, got ${typeof value}`)
  }
  return [value]
}

/** Throws unless exactly `count` arguments were sent. */
export function expectCount(args: readonly unknown[], count: number): void {
  if (args.length !== count) {
    throw new InvalidIpcArgumentsError(`expected ${count} arguments, got ${args.length}`)
  }
}

/** Scan IDs are UUIDs made by main; anything else is refused before it reaches the scanner. */
export const SCAN_ID_PATTERN = /^[0-9a-f-]{1,64}$/i

export function scanIdArg(value: unknown): string {
  if (typeof value !== 'string' || !SCAN_ID_PATTERN.test(value)) {
    throw new InvalidIpcArgumentsError('expected a scan id')
  }
  return value
}

export function nodeIdArg(value: unknown): NodeId {
  if (typeof value !== 'string' || !NODE_ID_PATTERN.test(value)) {
    throw new InvalidIpcArgumentsError('expected a tree node id')
  }
  return value
}

export function sortKeyArg(value: unknown): SortKey {
  if (!SORT_KEYS.includes(value as SortKey)) {
    throw new InvalidIpcArgumentsError(`expected one of ${SORT_KEYS.join(', ')}`)
  }
  return value as SortKey
}

export function sortDirArg(value: unknown): SortDir {
  if (value !== 'asc' && value !== 'desc') {
    throw new InvalidIpcArgumentsError('expected "asc" or "desc"')
  }
  return value
}

export function sizeModeArg(value: unknown): SizeMode {
  if (!SIZE_MODES.includes(value as SizeMode)) {
    throw new InvalidIpcArgumentsError(`expected one of ${SIZE_MODES.join(', ')}`)
  }
  return value as SizeMode
}

export function intArg(value: unknown, min: number, max: number, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InvalidIpcArgumentsError(`${name} must be a whole number from ${min} to ${max}`)
  }
  return value
}

export function booleanArg(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean')
    throw new InvalidIpcArgumentsError(`${name} must be true or false`)
  return value
}

/** Largest canvas the treemap lays out, in CSS px, per side. */
export const MAX_TREEMAP_SIDE = 10_000
/** Window coordinates accepted for the context menu, in CSS px. */
export const MAX_WINDOW_COORDINATE = 100_000

/** `[scanId, nodeId]` */
export function scanNodeArgs(args: readonly unknown[]): [string, NodeId] {
  expectCount(args, 2)
  return [scanIdArg(args[0]), nodeIdArg(args[1])]
}

/** `tree:children` */
export function childrenArgs(
  args: readonly unknown[],
): [string, NodeId, SortKey, SortDir, number, number] {
  expectCount(args, 6)
  return [
    scanIdArg(args[0]),
    nodeIdArg(args[1]),
    sortKeyArg(args[2]),
    sortDirArg(args[3]),
    intArg(args[4], 0, 2 ** 31 - 1, 'offset'),
    intArg(args[5], 1, MAX_PAGE_ROWS, 'limit'),
  ]
}

/** `tree:node` */
export function nodeArgs(args: readonly unknown[]): [string, NodeId, SortKey, SortDir] {
  expectCount(args, 4)
  return [scanIdArg(args[0]), nodeIdArg(args[1]), sortKeyArg(args[2]), sortDirArg(args[3])]
}

/** `tree:expand-ids` */
export function expandArgs(args: readonly unknown[]): [string, NodeId, number] {
  expectCount(args, 3)
  return [scanIdArg(args[0]), nodeIdArg(args[1]), intArg(args[2], 1, 64, 'levels')]
}

/** `treemap:layout` */
export function treemapArgs(
  args: readonly unknown[],
): [string, NodeId, SizeMode, number, number, number] {
  expectCount(args, 6)
  return [
    scanIdArg(args[0]),
    nodeIdArg(args[1]),
    sizeModeArg(args[2]),
    intArg(args[3], 0, MAX_TREEMAP_DEPTH, 'depth'),
    intArg(args[4], 1, MAX_TREEMAP_SIDE, 'width'),
    intArg(args[5], 1, MAX_TREEMAP_SIDE, 'height'),
  ]
}

/** `side:top-files`: `[scanId, nodeId, mode]` */
export function topFilesArgs(args: readonly unknown[]): [string, NodeId, SizeMode] {
  expectCount(args, 3)
  return [scanIdArg(args[0]), nodeIdArg(args[1]), sizeModeArg(args[2])]
}

/** `export:run`: `[scanId, nodeId, format]` */
export function exportArgs(args: readonly unknown[]): [string, NodeId, ExportFormat] {
  expectCount(args, 3)
  const format = args[2]
  if (!EXPORT_FORMATS.includes(format as ExportFormat)) {
    throw new InvalidIpcArgumentsError(`expected one of ${EXPORT_FORMATS.join(', ')}`)
  }
  return [scanIdArg(args[0]), nodeIdArg(args[1]), format as ExportFormat]
}

/** `clipboard:copy-text`: one string of 1 to `MAX_CLIPBOARD_TEXT` characters. */
export function copyTextArgs(args: readonly unknown[]): [string] {
  const [text] = oneString(args)
  if (text.length < 1 || text.length > MAX_CLIPBOARD_TEXT) {
    throw new InvalidIpcArgumentsError(`expected 1 to ${MAX_CLIPBOARD_TEXT} characters of text`)
  }
  return [text]
}

/** Most rows one Explorer action (menu, copy paths) takes. */
export const MAX_ACTION_ITEMS = 1000

/** An array of 1 to `max` valid node ids (not deduplicated). */
export function nodeIdListArg(value: unknown, max: number): NodeId[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) {
    throw new InvalidIpcArgumentsError(`expected 1 to ${max} tree node ids`)
  }
  // Array.from visits holes of a sparse array too (map would skip them).
  return Array.from(value as unknown[], (entry) => nodeIdArg(entry))
}

/** `[scanId, nodeIds]` */
export function scanNodesArgs(args: readonly unknown[]): [string, NodeId[]] {
  expectCount(args, 2)
  return [scanIdArg(args[0]), nodeIdListArg(args[1], MAX_ACTION_ITEMS)]
}

/** `shell:context-menu` */
export function contextMenuArgs(
  args: readonly unknown[],
): [string, NodeId[], number, number, boolean] {
  expectCount(args, 5)
  return [
    scanIdArg(args[0]),
    nodeIdListArg(args[1], MAX_ACTION_ITEMS),
    intArg(args[2], 0, MAX_WINDOW_COORDINATE, 'x'),
    intArg(args[3], 0, MAX_WINDOW_COORDINATE, 'y'),
    booleanArg(args[4], 'extended'),
  ]
}

/** `shell:delete`: `[scanId, nodeIds, permanent]` (1 to 1,000 ids and a strict boolean). */
export function deleteArgs(args: readonly unknown[]): [string, NodeId[], boolean] {
  expectCount(args, 3)
  return [
    scanIdArg(args[0]),
    nodeIdListArg(args[1], MAX_ACTION_ITEMS),
    booleanArg(args[2], 'permanent'),
  ]
}

/** `drive:info`: a drive root like `C:\` (or `C:`). */
export function driveRootArgs(args: readonly unknown[]): [string] {
  const [root] = oneString(args)
  const match = /^([A-Za-z]):\\?$/.exec(root)
  if (match === null) throw new InvalidIpcArgumentsError('expected a drive root like C:\\')
  return [`${(match[1] ?? '').toUpperCase()}:\\`]
}

/** Most node ids or type keys one icon call takes. */
export const MAX_ICON_ITEMS = 64

/** `icons:for-nodes`: `[scanId, nodeIds]` (1 to 64 ids). */
export function iconNodesArgs(args: readonly unknown[]): [string, NodeId[]] {
  expectCount(args, 2)
  return [scanIdArg(args[0]), nodeIdListArg(args[1], MAX_ICON_ITEMS)]
}

/**
 * The only keys the renderer may name for `icons:for-types`: no path, no drive letter, and no
 * extension containing a dot or a separator.
 */
export const ICON_TYPE_KEY_PATTERN = /^(dir|drive|file|ext:[a-z0-9_$~-]{1,16})$/

/** `icons:for-types`: `[typeKeys]` (an array of 1 to 64 keys). */
export function iconTypesArgs(args: readonly unknown[]): [string[]] {
  expectCount(args, 1)
  const [value] = args
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ICON_ITEMS) {
    throw new InvalidIpcArgumentsError(`expected 1 to ${MAX_ICON_ITEMS} icon type keys`)
  }
  return [
    Array.from(value as unknown[], (key) => {
      if (typeof key !== 'string' || !ICON_TYPE_KEY_PATTERN.test(key)) {
        throw new InvalidIpcArgumentsError('expected an icon type key')
      }
      return key
    }),
  ]
}

export const ABOUT_LINKS: readonly AboutLink[] = ['repo', 'license', 'releases', 'help', 'issues']

/** `app:open-link`: exactly one of the five fixed keys (never a URL). */
export function aboutLinkArg(args: readonly unknown[]): [AboutLink] {
  expectCount(args, 1)
  const [value] = args
  if (typeof value !== 'string' || !ABOUT_LINKS.includes(value as AboutLink)) {
    throw new InvalidIpcArgumentsError('expected a known link')
  }
  return [value as AboutLink]
}
