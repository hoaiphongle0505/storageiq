import type { ScanErrorKind } from '@shared/scan-types'
import type { WalkSink } from './walk'

/**
 * The wire format of one walker job: parallel typed arrays plus one `names` string, so a whole
 * job (about 2,000 records) crosses the thread boundary as a handful of transferred buffers and
 * no per-entry objects. A worker never knows TreeStore handles; it numbers the folders it finds
 * locally and `decodeBatch` maps local indexes to handles on the coordinator.
 */

export const KIND_FILE = 0 // files, links and every non-folder entry (links have size 0)
export const KIND_FOLDER = 1 // a real folder (not a link)

export interface ResultBatch {
  /** Number of records. Local folder index 0 is the job's own directory (handle known to the coordinator); folder records get 1, 2, 3 ... in record order. */
  count: number
  kinds: Uint8Array
  /** Local index of the containing folder (0 = job root). */
  parents: Uint32Array
  /** Bytes (0 for folders and links); exact up to 2^53. */
  sizes: Float64Array
  /** ms since epoch, 0 when unknown. */
  mtimes: Float64Array
  /** End offset (UTF-16 units) of each name inside `names`. */
  nameEnds: Uint32Array
  /** All names concatenated; a JS string, so lone surrogates of NTFS names survive cloning. */
  names: string
  /** Directory listing failures, in order. */
  errors: Array<{ path: string; code: string; kind: ScanErrorKind }>
  /** The last directory listed in this job (feeds `sink.visiting`). */
  visited: string
  /** Local indexes of folder records that were NOT walked (budget hit or abort). */
  pendingLocal: Uint32Array
  /** The same folders' full paths, parallel to `pendingLocal`. */
  pendingPaths: string[]
}

const INITIAL_CAPACITY = 256

export class BatchBuilder {
  private capacity = INITIAL_CAPACITY
  private count = 0
  private folders = 0
  private kinds = new Uint8Array(INITIAL_CAPACITY)
  private parents = new Uint32Array(INITIAL_CAPACITY)
  private sizes = new Float64Array(INITIAL_CAPACITY)
  private mtimes = new Float64Array(INITIAL_CAPACITY)
  private nameEnds = new Uint32Array(INITIAL_CAPACITY)
  private names = ''
  private readonly errors: ResultBatch['errors'] = []
  private visited = ''
  private readonly pendingLocal: number[] = []
  private readonly pendingPaths: string[] = []

  /** Records added so far. */
  get records(): number {
    return this.count
  }

  addFile(parentLocal: number, name: string, size: number, mtime: number): void {
    this.push(KIND_FILE, parentLocal, name, size, mtime)
  }

  /** Returns the new folder's local index. */
  addFolder(parentLocal: number, name: string, mtime: number): number {
    this.push(KIND_FOLDER, parentLocal, name, 0, mtime)
    this.folders += 1
    return this.folders
  }

  addError(path: string, code: string, kind: ScanErrorKind): void {
    this.errors.push({ path, code, kind })
  }

  setVisited(path: string): void {
    this.visited = path
  }

  addPending(local: number, path: string): void {
    this.pendingLocal.push(local)
    this.pendingPaths.push(path)
  }

  finish(): ResultBatch {
    const n = this.count
    return {
      count: n,
      kinds: this.kinds.slice(0, n),
      parents: this.parents.slice(0, n),
      sizes: this.sizes.slice(0, n),
      mtimes: this.mtimes.slice(0, n),
      nameEnds: this.nameEnds.slice(0, n),
      names: this.names,
      errors: this.errors,
      visited: this.visited,
      pendingLocal: Uint32Array.from(this.pendingLocal),
      pendingPaths: this.pendingPaths,
    }
  }

  private push(kind: number, parent: number, name: string, size: number, mtime: number): void {
    if (this.count === this.capacity) this.grow()
    const i = this.count
    this.kinds[i] = kind
    this.parents[i] = parent
    this.sizes[i] = size
    this.mtimes[i] = mtime
    this.names += name
    this.nameEnds[i] = this.names.length
    this.count = i + 1
  }

  private grow(): void {
    const next = this.capacity * 2
    const widen = <T extends Uint8Array | Uint32Array | Float64Array>(
      old: T,
      make: (n: number) => T,
    ): T => {
      const bigger = make(next)
      bigger.set(old)
      return bigger
    }
    this.kinds = widen(this.kinds, (n) => new Uint8Array(n))
    this.parents = widen(this.parents, (n) => new Uint32Array(n))
    this.sizes = widen(this.sizes, (n) => new Float64Array(n))
    this.mtimes = widen(this.mtimes, (n) => new Float64Array(n))
    this.nameEnds = widen(this.nameEnds, (n) => new Uint32Array(n))
    this.capacity = next
  }
}

/**
 * Applies a batch to the sink, in this order: every error, the records in order, then
 * `visiting`. Returns the unwalked folders with their handles. A worker emits a folder record
 * before any record naming it as parent, so one in-order pass is enough.
 */
export function decodeBatch<D>(
  batch: ResultBatch,
  rootHandle: D,
  sink: WalkSink<D>,
): Array<{ handle: D; path: string }> {
  for (const error of batch.errors) sink.error(error.path, error.code, error.kind)
  const handles: D[] = [rootHandle]
  const { kinds, parents, sizes, mtimes, nameEnds, names } = batch
  let start = 0
  for (let i = 0; i < batch.count; i += 1) {
    const end = nameEnds[i] ?? start
    const name = names.slice(start, end)
    start = end
    const parent = handles[parents[i] ?? 0] as D
    if (kinds[i] === KIND_FOLDER) {
      handles.push(sink.folder(parent, name, mtimes[i] ?? 0))
    } else {
      sink.file(parent, sizes[i] ?? 0, name, mtimes[i] ?? 0)
    }
  }
  if (batch.visited !== '') sink.visiting(batch.visited)
  const pending: Array<{ handle: D; path: string }> = []
  for (let k = 0; k < batch.pendingLocal.length; k += 1) {
    pending.push({
      handle: handles[batch.pendingLocal[k] ?? 0] as D,
      path: batch.pendingPaths[k] ?? '',
    })
  }
  return pending
}

/** The typed-array buffers, to pass to `postMessage` so they are moved, not copied. */
export function batchTransferList(batch: ResultBatch): ArrayBuffer[] {
  return [
    batch.kinds.buffer,
    batch.parents.buffer,
    batch.sizes.buffer,
    batch.mtimes.buffer,
    batch.nameEnds.buffer,
    batch.pendingLocal.buffer,
  ] as ArrayBuffer[]
}
