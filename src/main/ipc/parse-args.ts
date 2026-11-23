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

/** Most rows one Explorer action (menu, copy paths) takes. */
export const MAX_ACTION_ITEMS = 1000

/** An array of 1 to `max` valid node ids (not deduplicated). */
export function nodeIdListArg(value: unknown, max: number): NodeId[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) {
    throw new InvalidIpcArgumentsError(`expected 1 to ${max} tree node ids`)
  }
  return value.map((entry: unknown) => nodeIdArg(entry))
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

/** `drive:info`: a drive root like `C:\` (or `C:`). */
export function driveRootArgs(args: readonly unknown[]): [string] {
  const [root] = oneString(args)
  const match = /^([A-Za-z]):\\?$/.exec(root)
  if (match === null) throw new InvalidIpcArgumentsError('expected a drive root like C:\\')
  return [`${(match[1] ?? '').toUpperCase()}:\\`]
}
