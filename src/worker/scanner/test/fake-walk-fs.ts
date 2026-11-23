import path from 'node:path'
import type { WalkDirent, WalkFs, WalkStats } from '../walk'

export type FakeNode =
  | { type: 'dir'; children: Record<string, FakeNode> }
  | { type: 'file'; size: number; mtimeMs: number }
  | { type: 'link' }

export const dir = (children: Record<string, FakeNode> = {}): FakeNode => ({
  type: 'dir',
  children,
})
export const file = (size: number, mtimeMs = 0): FakeNode => ({ type: 'file', size, mtimeMs })
/** A symlink or junction. Its `lstat` size is deliberately non-zero: the walk must count 0 bytes. */
export const link = (): FakeNode => ({ type: 'link' })

export interface FakeWalkFsOptions {
  /** `opendir` rejects with this error code for these paths. */
  opendirErrors?: Record<string, string>
  /** Listing these paths yields one entry, then fails with this error code. */
  iterationErrors?: Record<string, string>
  /** `lstat` rejects with this error code for these paths. */
  lstatErrors?: Record<string, string>
  /** Awaited at the start of every `opendir` call (lets a test slow down or abort the walk). */
  beforeOpendir?(dirPath: string): Promise<void>
}

export interface FakeWalkFs extends WalkFs {
  /** Every path passed to `opendir`, in call order. */
  readonly opendirCalls: string[]
  /** The most directories that were being listed at the same moment. */
  readonly maxListingAtOnce: number
}

export function codeError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(code)
  error.code = code
  return error
}

export function createFakeWalkFs(
  rootPath: string,
  root: FakeNode,
  options: FakeWalkFsOptions = {},
): FakeWalkFs {
  // Entries are looked up from `root` on every call, so a test can change the tree between scans.
  const nodes = {
    get(nodePath: string): FakeNode | undefined {
      const relative = path.relative(rootPath, nodePath)
      if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
      let node: FakeNode | undefined = root
      for (const name of relative === '' ? [] : relative.split(path.sep)) {
        node = node?.type === 'dir' ? node.children[name] : undefined
      }
      return node
    },
  }

  const opendirCalls: string[] = []
  let listing = 0
  let maxListing = 0

  return {
    opendirCalls,
    get maxListingAtOnce() {
      return maxListing
    },

    async opendir(dirPath) {
      opendirCalls.push(dirPath)
      listing += 1
      maxListing = Math.max(maxListing, listing)
      try {
        await options.beforeOpendir?.(dirPath)
        const code = options.opendirErrors?.[dirPath]
        if (code !== undefined) throw codeError(code)
        const node = nodes.get(dirPath)
        if (node === undefined) throw codeError('ENOENT')
        if (node.type !== 'dir') throw codeError('ENOTDIR')
        const names = Object.keys(node.children)
        const failAfterFirst = options.iterationErrors?.[dirPath]
        return (async function* (): AsyncGenerator<WalkDirent> {
          try {
            for (const name of names) {
              await Promise.resolve()
              // Like a real Dirent, `isDirectory` only works as a method call (it reads `this`).
              yield {
                name,
                isDirectory(this: { name: string }) {
                  return nodes.get(path.join(dirPath, this.name))?.type === 'dir'
                },
              }
              if (failAfterFirst !== undefined) throw codeError(failAfterFirst)
            }
          } finally {
            listing -= 1
          }
        })()
      } catch (error) {
        listing -= 1
        throw error
      }
    },

    async lstat(entryPath): Promise<WalkStats> {
      const code = options.lstatErrors?.[entryPath]
      if (code !== undefined) throw codeError(code)
      const node = nodes.get(entryPath)
      if (node === undefined) throw codeError('ENOENT')
      return {
        size: node.type === 'file' ? node.size : node.type === 'link' ? 42 : 0,
        mtimeMs: node.type === 'file' ? node.mtimeMs : 0,
        isDirectory: () => node.type === 'dir',
        isSymbolicLink: () => node.type === 'link',
      }
    },
  }
}
