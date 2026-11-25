import type { NodeId, TreeRow } from '@shared/tree-types'

/**
 * Multi-select state of the tree (APG multi-select treegrid). The active row is the focused one:
 * what `aria-activedescendant` names and what the treemap shows. It is separate from the set of
 * selected rows, so Ctrl+arrows can move it without changing the set.
 */
export interface Selection {
  ids: ReadonlySet<NodeId>
  activeId: NodeId | null
  /** Where a Shift range starts. */
  anchorId: NodeId | null
}

/** Only `id` is selected, active and the anchor. */
export function single(id: NodeId): Selection {
  return { ids: new Set([id]), activeId: id, anchorId: id }
}

/** Adds or removes `id`; it becomes the active row and the anchor either way. */
export function toggle(selection: Selection, id: NodeId): Selection {
  const ids = new Set(selection.ids)
  if (!ids.delete(id)) ids.add(id)
  return { ids, activeId: id, anchorId: id }
}

/** The ids of `visibleIds` between positions `a` and `b`, in either order, inclusive. */
function between(visibleIds: readonly NodeId[], a: number, b: number): NodeId[] {
  const from = Math.min(a, b)
  const to = Math.max(a, b)
  return visibleIds.slice(from, to + 1)
}

/**
 * Selects the rows from the anchor to `toId` in visible order (collapsed descendants are not in
 * `visibleIds`, so they are skipped). `additive` keeps the rows already selected; otherwise the
 * range replaces the set. The anchor stays where it was.
 */
export function rangeTo(
  selection: Selection,
  visibleIds: readonly NodeId[],
  toId: NodeId,
  additive: boolean,
): Selection {
  const anchorId = selection.anchorId ?? selection.activeId ?? toId
  const to = visibleIds.indexOf(toId)
  const anchorIndex = visibleIds.indexOf(anchorId)
  const range = to === -1 ? [] : between(visibleIds, anchorIndex === -1 ? to : anchorIndex, to)
  const ids = new Set(additive ? selection.ids : [])
  for (const id of range) ids.add(id)
  if (to === -1) ids.add(toId)
  return { ids, activeId: toId, anchorId }
}

/** Every visible row is selected; the active row (or the first row) stays active. */
export function selectAll(visibleIds: readonly NodeId[], selection: Selection): Selection {
  const activeId = selection.activeId ?? visibleIds[0] ?? null
  return { ids: new Set(visibleIds), activeId, anchorId: selection.anchorId ?? activeId }
}

/** Moves the active row by `delta` rows (clamped) and selects the range from the anchor to it. */
export function extendBy(
  selection: Selection,
  visibleIds: readonly NodeId[],
  delta: number,
): Selection {
  if (visibleIds.length === 0) return selection
  const current = selection.activeId === null ? -1 : visibleIds.indexOf(selection.activeId)
  const target = Math.max(
    0,
    Math.min(visibleIds.length - 1, (current === -1 ? 0 : current) + delta),
  )
  const toId = visibleIds[target]
  return toId === undefined ? selection : rangeTo(selection, visibleIds, toId, false)
}

const byId = (a: NodeId, b: NodeId): number => a.localeCompare(b, 'en', { numeric: true })

/** The selected ids in tree order; ids that are not visible follow, in id order. */
export function orderedIds(selection: Selection, visibleIds: readonly NodeId[]): NodeId[] {
  const shown = visibleIds.filter((id) => selection.ids.has(id))
  const seen = new Set(shown)
  const hidden = [...selection.ids].filter((id) => !seen.has(id)).sort(byId)
  return [...shown, ...hidden]
}

/** Drops every id that has a selected ancestor (`parentOf` walks up the loaded parent chain). */
export function dropDescendants(
  ids: Iterable<NodeId>,
  parentOf: (id: NodeId) => NodeId | null,
): NodeId[] {
  const all = [...ids]
  const selected = new Set(all)
  return all.filter((id) => {
    const seen = new Set<NodeId>()
    for (let parent = parentOf(id); parent !== null; parent = parentOf(parent)) {
      if (selected.has(parent)) return false
      if (seen.has(parent)) break
      seen.add(parent)
    }
    return true
  })
}

/**
 * Items and bytes of a selection. Every id counts as an item; rows whose data is not loaded
 * count as `unknown` and add no bytes. A row inside another selected row is not added twice.
 */
export function selectionTotal(
  ids: ReadonlySet<NodeId>,
  rowOf: (id: NodeId) => TreeRow | null,
): { count: number; bytes: number; unknown: number } {
  const roots = dropDescendants(ids, (id) => rowOf(id)?.parentId ?? null)
  let bytes = 0
  let unknown = 0
  for (const id of ids) if (rowOf(id) === null) unknown += 1
  for (const id of roots) bytes += rowOf(id)?.size ?? 0
  return { count: ids.size, bytes, unknown }
}
