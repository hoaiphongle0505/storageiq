import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { ScanErrorKind } from '@shared/scan-types'

/**
 * One directory entry. `isDirectory()` comes from the directory listing itself (no handle is
 * opened), so it is known even when `lstat` later fails. For entries `lstat` can read, the
 * walk trusts `lstat` for the type.
 */
export interface WalkDirent {
  name: string
  isDirectory(): boolean
}

export interface WalkStats {
  size: number
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/**
 * The only file-system calls the scanner makes. There is deliberately no way to open or read a
 * file, so the scan can never download a cloud placeholder or touch file contents.
 */
export interface WalkFs {
  opendir(dirPath: string): Promise<AsyncIterable<WalkDirent>>
  lstat(entryPath: string): Promise<WalkStats>
}

export const nodeWalkFs: WalkFs = {
  opendir: (dirPath) => fsp.opendir(dirPath, { bufferSize: 128 }),
  lstat: (entryPath) => fsp.lstat(entryPath),
}

/** Receives everything the walk finds. `D` is the sink's own handle for a folder. */
export interface WalkSink<D> {
  /** A real folder (not a link) was found inside `parent`; returns its handle. */
  folder(parent: D, name: string): D
  /** A file, link or other non-folder entry inside `parent`. Links count with 0 bytes. */
  file(parent: D, bytes: number): void
  /** `path` could not be listed or inspected; the walk continues. */
  error(path: string, code: string, kind: ScanErrorKind): void
  /** The walk started listing `path`. */
  visiting(path: string): void
}

export interface WalkOptions {
  fs: WalkFs
  signal: AbortSignal
  /** Directories listed at the same time; capped at `MAX_DIRECTORIES_IN_FLIGHT`. */
  concurrency?: number
}

export const MAX_DIRECTORIES_IN_FLIGHT = 16
/** Entries of one directory inspected with `lstat` at the same time. */
const LSTAT_BATCH_SIZE = 64

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
 * (a listing in progress stops at its next entry). Resolves when all started work has settled;
 * rejects only if the sink throws.
 */
export function walk<D>(
  rootPath: string,
  rootHandle: D,
  sink: WalkSink<D>,
  options: WalkOptions,
): Promise<void> {
  const { fs, signal } = options
  const limit = Math.max(
    1,
    Math.min(options.concurrency ?? MAX_DIRECTORIES_IN_FLIGHT, MAX_DIRECTORIES_IN_FLIGHT),
  )
  const queue: Array<{ path: string; handle: D }> = [{ path: rootPath, handle: rootHandle }]
  let inFlight = 0

  return new Promise<void>((resolve, reject) => {
    let failed = false

    const inspect = async (dirPath: string, handle: D, entries: WalkDirent[]): Promise<void> => {
      const results = await Promise.all(
        entries.map(async (entry) => {
          const { name } = entry
          const entryPath = path.join(dirPath, name)
          try {
            return { name, entryPath, stats: await fs.lstat(entryPath) }
          } catch (error) {
            const isFolder = entry.isDirectory() // a method call: a real Dirent needs its own `this`
            sink.error(entryPath, errorCode(error), isFolder ? 'folder' : 'file')
            // Windows refuses lstat on locked system files (pagefile.sys, hiberfil.sys,
            // swapfile.sys, DumpStack.log.tmp). They are still files, so count them, at 0
            // bytes. Phase 2b will read their real size through koffi (FindFirstFileExW).
            if (!isFolder) sink.file(handle, 0)
            return null
          }
        }),
      )
      for (const result of results) {
        if (result === null) continue
        const { stats } = result
        if (stats.isSymbolicLink()) {
          sink.file(handle, 0) // symlinks and junctions are counted, never entered
        } else if (stats.isDirectory()) {
          queue.push({ path: result.entryPath, handle: sink.folder(handle, result.name) })
        } else {
          sink.file(handle, stats.size)
        }
      }
      pump()
    }

    const listDirectory = async (dirPath: string, handle: D): Promise<void> => {
      sink.visiting(dirPath)
      let entries: AsyncIterable<WalkDirent>
      try {
        entries = await fs.opendir(dirPath)
      } catch (error) {
        sink.error(dirPath, errorCode(error), 'folder')
        return
      }
      let batch: WalkDirent[] = []
      try {
        for await (const entry of entries) {
          if (signal.aborted) break
          batch.push(entry)
          if (batch.length >= LSTAT_BATCH_SIZE) {
            const entriesToInspect = batch
            batch = []
            await inspect(dirPath, handle, entriesToInspect)
          }
        }
      } catch (error) {
        sink.error(dirPath, errorCode(error), 'folder')
      }
      if (!signal.aborted && batch.length > 0) await inspect(dirPath, handle, batch)
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
