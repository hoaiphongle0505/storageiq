import { CATEGORY_LABELS } from '@shared/file-category'
import type { TypeRow } from '@shared/tree-types'
import { donutPath, pieSlices } from '../lib/chart-geometry'
import { formatShare, formatSize } from '../lib/format'
import { categoryTotals, chartSummary } from '../lib/side-view-model'
import { useWorkspace } from '../stores/workspace-store-context'
import { CategorySwatch } from './TreemapLegend'

const SIZE = 160
const CENTER = SIZE / 2
const OUTER = 76
const INNER = 48

/**
 * A donut of the folder's space by file type, in the treemap's colours: largest first, clockwise
 * from 12 o'clock, the total in the middle and a legend beside it. The picture is named by its
 * three biggest types; the table next to it holds all the data.
 */
export function TypesChart({ rows }: { rows: readonly TypeRow[] }) {
  const unit = useWorkspace((s) => s.unit)
  const totals = categoryTotals(rows)
  const total = totals.reduce((sum, entry) => sum + entry.bytes, 0)
  if (total === 0) return null
  const slices = pieSlices(totals.map((entry) => entry.bytes))
  const summary = chartSummary(
    totals.map((entry) => ({ label: CATEGORY_LABELS[entry.category], value: entry.bytes })),
  )
  return (
    <div className="flex items-center gap-3">
      <svg
        role="img"
        aria-label={`Space by file type: ${summary}`}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="shrink-0"
      >
        {slices.map((slice) => {
          const entry = totals[slice.index]
          if (entry === undefined) return null
          return (
            <path
              key={entry.category}
              d={donutPath(CENTER, CENTER, OUTER, INNER, slice.startDeg, slice.endDeg)}
              style={{ fill: `var(--treemap-${entry.category})` }}
              strokeWidth={1}
              className="stroke-panel forced-colors:stroke-[CanvasText]"
            />
          )
        })}
        <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="fill-ink-muted text-xs">
          Total
        </text>
        <text
          x={CENTER}
          y={CENTER + 14}
          textAnchor="middle"
          className="fill-ink text-[15px] font-semibold"
        >
          {formatSize(total, unit)}
        </text>
      </svg>
      <ul aria-label="File types by size" className="min-w-0 flex-1 text-xs leading-5 tabular-nums">
        {totals.map((entry) => (
          <li key={entry.category} className="flex items-center gap-1.5">
            <CategorySwatch category={entry.category} />
            <span className="min-w-0 flex-1 truncate text-ink">
              {CATEGORY_LABELS[entry.category]}
            </span>
            <span className="text-ink-muted">{formatSize(entry.bytes, unit)}</span>
            <span className="w-11 text-right text-ink-muted">
              {formatShare(entry.bytes / total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
