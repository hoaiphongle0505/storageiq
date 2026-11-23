import path from 'node:path'
import type { ScanErrorKind } from '@shared/scan-types'

/** One directory entry as the directory listing reports it (no file is opened). */
export interface ListedEntry {
  name: string
  isDirectory: boolean
  /** symlink or junction: counted at 0 bytes, never entered */
  isLink: boolean
  size: number
  modifiedMs: number
}

export interface DirectoryListing {
  entries: ListedEntry[]
  /** Node-style code when the listing failed (completely or part-way); null when complete */
  errorCode: string | null
}

/**
 * The only file-system call the scanner makes. There is deliberately no way to open or read a
 * file, so the scan can never download a cloud placeholder or touch file contents. It never
 * rejects for file-system errors (they come back in `errorCode`); it may reject only for a
 * programming error.
 */
export interface DirectoryLister {
  list(dirPath: string): Promise<DirectoryListing>
}

/** Receives everything the walk finds. `D` is the sink's own handle for a folder. */
export interface WalkSink<D> {
  /** A real folder (not a link) was found inside `parent`; returns its handle. */
  folder(parent: D, name: string, modifiedMs: number): D
  /**
   * A file, link or other non-folder entry inside `parent`. Links count with 0 bytes.
   * `modifiedMs` is 0 when the listing has no time.
   */
  file(parent: D, bytes: number, name: string, modifiedMs: number): void
  /** `path` could not be listed (completely); the walk continues. */
  error(path: string, code: string, kind: ScanErrorKind): void
  /** The walk started listing `path`. */
  visiting(path: string): void
}

export interface WalkOptions {
  lister: DirectoryLister
  signal: AbortSignal
  /** Directories listed at the same time; capped at `MAX_DIRECTORIES_IN_FLIGHT`. */
  concurrency?: number
}

/**
 * Directories listed at once. Only the directory opens overlap (the listing itself is a
 * synchronous loop), so a higher value mostly adds memory. Measured on `C:\Program Files`
 * with `scripts/bench-walk.mjs`: 4 / 8 / 16 in flight gave roughly 15-37k / 10-25k / 17-29k files/s over four
 * runs each, so the differences are inside the run-to-run noise (about +-50%); 8 is the default.
 */
export const MAX_DIRECTORIES_IN_FLIGHT = 8
/** Entries handled between two abort checks, so an abort in a huge folder returns promptly. */
const ABORT_CHUNK = 4096

export function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return 'UNKNOWN'
}

/**
 * Walks `rootPath` with at most `concurrency` directories in flight. It never follows symlinks
 * or junctions, never opens file contents, and stops starting work as soon as `signal` aborts
 * (a listing being handled stops at its next chunk of entries). Resolves when all started work
 * has settled; rejects only if the sink throws.
 */
export function walk<D>(
  rootPath: string,
  rootHandle: D,
  sink: WalkSink<D>,
  options: WalkOptions,
): Promise<void> {
  const { lister, signal } = options
  const limit = Math.max(
    1,
    Math.min(options.concurrency ?? MAX_DIRECTORIES_IN_FLIGHT, MAX_DIRECTORIES_IN_FLIGHT),
  )
  const queue: Array<{ path: string; handle: D }> = [{ path: rootPath, handle: rootHandle }]
  let inFlight = 0

  return new Promise<void>((resolve, reject) => {
    let failed = false

    const listDirectory = async (dirPath: string, handle: D): Promise<void> => {
      sink.visiting(dirPath)
      const listing = await lister.list(dirPath)
      if (listing.errorCode !== null) sink.error(dirPath, listing.errorCode, 'folder')
      const { entries } = listing
      for (let start = 0; start < entries.length; start += ABORT_CHUNK) {
        if (signal.aborted) return
        const end = Math.min(start + ABORT_CHUNK, entries.length)
        for (let i = start; i < end; i += 1) {
          const entry = entries[i]
          if (entry === undefined) continue
          if (entry.isLink) {
            // symlinks and junctions are counted, never entered (even when they are folders)
            sink.file(handle, 0, entry.name, entry.modifiedMs)
          } else if (entry.isDirectory) {
            queue.push({
              path: path.join(dirPath, entry.name),
              handle: sink.folder(handle, entry.name, entry.modifiedMs),
            })
          } else {
            sink.file(handle, entry.size, entry.name, entry.modifiedMs)
          }
        }
      }
    }

    const pump = (): void => {
      if (failed) return
      while (!signal.aborted && inFlight < limit) {
        const next = queue.pop()
        if (next === undefined) break
        inFlight += 1
        listDirectory(next.path, next.handle).then(
          () => {
            inFlight -= 1
            pump()
          },
          (error: unknown) => {
            failed = true
            reject(error)
          },
        )
      }
      if (inFlight === 0 && (signal.aborted || queue.length === 0)) resolve()
    }

    pump()
  })
}
