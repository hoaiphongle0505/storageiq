import path from 'node:path'
import type { SyncLister } from './walk'
import { BatchBuilder, type ResultBatch } from './walker-batch'

/** Stop starting new directories once this many records are in the batch ... */
export const WALKER_BUDGET_ENTRIES = 2000
/** ... or once this many directories were listed. */
export const WALKER_BUDGET_DIRECTORIES = 64
/** The abort flag is checked every this many entries inside one listing. */
export const ABORT_CHECK_ENTRIES = 4096

/**
 * One walker job: a depth-first walk of `dirPath` and whatever is below it, on the calling
 * thread, until the budget is used up. A directory listing is never split: the budget is checked
 * only between directories, and the directories still on the local stack come back as pending
 * (the coordinator turns them into new jobs for idle workers, which is the work stealing). Links
 * are counted as 0-byte files and never entered; `isLink` is decided by the lister. Never throws
 * for file-system errors (they become error records).
 */
export function runJob(
  dirPath: string,
  lister: SyncLister,
  shouldStop: () => boolean,
  budget: { entries: number; directories: number } = {
    entries: WALKER_BUDGET_ENTRIES,
    directories: WALKER_BUDGET_DIRECTORIES,
  },
): ResultBatch {
  const batch = new BatchBuilder()
  const stack: Array<{ local: number; path: string }> = [{ local: 0, path: dirPath }]
  let listed = 0
  let stopped = false

  while (stack.length > 0) {
    if (stopped || shouldStop()) break
    if (listed > 0 && (batch.records >= budget.entries || listed >= budget.directories)) break
    const next = stack.pop()
    if (next === undefined) break
    listed += 1
    batch.setVisited(next.path)
    const listing = lister.listSync(next.path)
    if (listing.errorCode !== null) batch.addError(next.path, listing.errorCode, 'folder')
    const { entries } = listing
    for (let i = 0; i < entries.length; i += 1) {
      if (i > 0 && i % ABORT_CHECK_ENTRIES === 0 && shouldStop()) {
        stopped = true
        break
      }
      const entry = entries[i]
      if (entry === undefined) continue
      if (entry.isLink) {
        batch.addFile(next.local, entry.name, 0, entry.modifiedMs)
      } else if (entry.isDirectory) {
        const local = batch.addFolder(next.local, entry.name, entry.modifiedMs)
        stack.push({ local, path: path.join(next.path, entry.name) })
      } else {
        batch.addFile(next.local, entry.name, entry.size, entry.modifiedMs)
      }
    }
  }

  for (const rest of stack) batch.addPending(rest.local, rest.path)
  return batch.finish()
}
