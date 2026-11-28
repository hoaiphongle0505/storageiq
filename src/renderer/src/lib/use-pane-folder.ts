import { rowName } from './format'
import { useWorkspace } from '../stores/workspace-store-context'

/** The name of the folder the bottom pane describes (the treemap folder), once its row is loaded. */
export function usePaneFolderName(): string | null {
  const treemapRootId = useWorkspace((s) => s.treemapRootId)
  const lists = useWorkspace((s) => s.lists)
  if (treemapRootId === null) return null
  const row =
    lists[treemapRootId]?.parent ??
    Object.values(lists)
      .flatMap((list) => Object.values(list.chunks).flatMap((chunk) => chunk.rows))
      .find((candidate) => candidate.id === treemapRootId) ??
    null
  return row === null ? null : rowName(row)
}
