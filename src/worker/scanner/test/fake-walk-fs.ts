import path from 'node:path'
import type { DirectoryLister, DirectoryListing, ListedEntry, SyncLister } from '../walk'

export type FakeNode =
  | { type: 'dir'; children: Record<string, FakeNode>; mtimeMs: number }
  | { type: 'file'; size: number; mtimeMs: number }
  | { type: 'link'; isDirectory: boolean }

export const dir = (children: Record<string, FakeNode> = {}, mtimeMs = 0): FakeNode => ({
  type: 'dir',
  children,
  mtimeMs,
})
export const file = (size: number, mtimeMs = 0): FakeNode => ({ type: 'file', size, mtimeMs })
/** A symlink or junction (to a directory when `isDirectory`). The walk must count 0 bytes. */
export const link = (isDirectory = false): FakeNode => ({ type: 'link', isDirectory })

export interface FakeWalkFsOptions {
  /** The listing fails completely with this error code for these paths. */
  listErrors?: Record<string, string>
  /** Listing these paths yields the first entry, then this error code. */
  partialErrors?: Record<string, string>
  /** Awaited at the start of every `list` call (lets a test slow down or abort the walk). */
  beforeList?(dirPath: string): Promise<void>
}

export interface FakeWalkFs extends DirectoryLister {
  /** The same tree as a synchronous lister (what a walker worker uses). */
  syncLister(): SyncLister
  /** Every path passed to `list`, in call order. */
  readonly listCalls: string[]
  /** The most directories that were being listed at the same moment. */
  readonly maxListingAtOnce: number
}

export function codeError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(code)
  error.code = code
  return error
}

function toEntry(name: string, node: FakeNode): ListedEntry {
  switch (node.type) {
    case 'dir':
      return { name, isDirectory: true, isLink: false, size: 0, modifiedMs: node.mtimeMs }
    case 'file':
      return {
        name,
        isDirectory: false,
        isLink: false,
        size: node.size,
        modifiedMs: node.mtimeMs,
      }
    case 'link':
      // A real link entry reports a non-zero size; the walk must still count 0 bytes.
      return { name, isDirectory: node.isDirectory, isLink: true, size: 42, modifiedMs: 0 }
  }
}

export function createFakeWalkFs(
  rootPath: string,
  root: FakeNode,
  options: FakeWalkFsOptions = {},
): FakeWalkFs {
  // Entries are looked up from `root` on every call, so a test can change the tree between scans.
  const find = (nodePath: string): FakeNode | undefined => {
    const relative = path.relative(rootPath, nodePath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
    let node: FakeNode | undefined = root
    for (const name of relative === '' ? [] : relative.split(path.sep)) {
      node = node?.type === 'dir' ? node.children[name] : undefined
    }
    return node
  }

  const compute = (dirPath: string): DirectoryListing => {
    const code = options.listErrors?.[dirPath]
    if (code !== undefined) return { entries: [], errorCode: code }
    const node = find(dirPath)
    if (node === undefined) return { entries: [], errorCode: 'ENOENT' }
    if (node.type !== 'dir') return { entries: [], errorCode: 'ENOTDIR' }
    const entries = Object.entries(node.children).map(([name, child]) => toEntry(name, child))
    const partial = options.partialErrors?.[dirPath]
    if (partial !== undefined) return { entries: entries.slice(0, 1), errorCode: partial }
    return { entries, errorCode: null }
  }

  const listCalls: string[] = []
  let listing = 0
  let maxListing = 0

  return {
    listCalls,
    get maxListingAtOnce() {
      return maxListing
    },

    syncLister: () => ({ listSync: (dirPath) => compute(dirPath) }),

    async list(dirPath): Promise<DirectoryListing> {
      listCalls.push(dirPath)
      listing += 1
      maxListing = Math.max(maxListing, listing)
      try {
        await options.beforeList?.(dirPath)
        await Promise.resolve()
        return compute(dirPath)
      } finally {
        listing -= 1
      }
    },
  }
}
