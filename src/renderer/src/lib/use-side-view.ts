import { useEffect, useState } from 'react'
import { useWorkspace } from '../stores/workspace-store-context'

/** What a side view has: nothing yet, the rows, or "that folder no longer exists". */
export type SideViewState<T> =
  { status: 'loading' } | { status: 'ready'; rows: T[] } | { status: 'gone' }

/**
 * Loads a side view for the treemap folder of the current scan, and again whenever the folder,
 * the scan or the tree revision (throttled while a scan runs, like the treemap) changes, or
 * `extraKey` does (the Mode, for Top files). The rows of the previous answer stay on screen until
 * the new one arrives, and an answer that is no longer the newest is dropped.
 */
export function useSideView<T>(fetch: () => Promise<T[] | null>, extraKey = ''): SideViewState<T> {
  const scanId = useWorkspace((s) => s.scanId)
  const treemapRootId = useWorkspace((s) => s.treemapRootId)
  const revision = useWorkspace((s) => s.revision)
  const [state, setState] = useState<SideViewState<T>>({ status: 'loading' })

  useEffect(() => {
    if (scanId === null || treemapRootId === null) {
      setState({ status: 'loading' })
      return
    }
    let current = true
    void fetch().then((rows) => {
      if (current) setState(rows === null ? { status: 'gone' } : { status: 'ready', rows })
    })
    return () => {
      current = false
    }
  }, [scanId, treemapRootId, revision, extraKey, fetch])

  return state
}
