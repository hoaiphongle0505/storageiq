import type { ReactNode } from 'react'
import { formatShare } from '../lib/format'
import { useWorkspace } from '../stores/workspace-store-context'

/** Row height of the side-view tables (the same as the folder tree's rows). */
export const SIDE_ROW_CLASS = 'h-[30px]'

/** A bar and the share as text, like the tree's "% of Parent" cell; the text is the accessible value. */
export function ShareBar({ share }: { share: number }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-1.5 w-12 shrink-0 overflow-hidden rounded-pill bg-bar-track"
      >
        <span
          className="block h-full rounded-pill bg-bar-fill forced-colors:bg-[Highlight]"
          style={{ width: `${Math.min(1, share) * 100}%` }}
        />
      </span>
      <span className="flex-1 text-right">{formatShare(share)}</span>
    </span>
  )
}

/** A line above the list while the scan is still running: the rows are what was found so far. */
export function ScanningNote() {
  const scanning = useWorkspace((s) => s.phase === 'scanning')
  if (!scanning) return null
  return (
    <p className="shrink-0 px-3 pb-1 text-xs leading-4 text-ink-muted">
      Scanning… These are the results so far.
    </p>
  )
}

/** A calm one-line message in the body of a view. */
export function PaneMessage({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-ink-muted">{children}</p>
}

export interface TableColumn {
  label: string
  numeric?: boolean
}

/**
 * A short table (Types and Age): a `grid` with column headers, in a focusable scroll area so the
 * keyboard can scroll it. The header stays in view while the rows scroll.
 */
export function SideViewTable({
  label,
  columns,
  children,
}: {
  label: string
  columns: TableColumn[]
  children: ReactNode
}) {
  return (
    <div tabIndex={0} className="min-h-0 flex-1 overflow-auto focus-visible:outline-offset-[-2px]">
      <table
        aria-label={label}
        className="w-full border-collapse text-[13px] leading-[18px] tabular-nums"
      >
        <thead className="sticky top-0 bg-panel">
          <tr>
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={`h-(--size-header-row) border-b border-line px-3 font-medium text-ink-muted ${column.numeric ? 'text-right' : 'text-left'}`}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
