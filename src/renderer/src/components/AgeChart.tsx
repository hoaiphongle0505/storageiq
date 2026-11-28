import type { AgeRow } from '@shared/tree-types'
import { barLengths } from '../lib/chart-geometry'
import { formatSize } from '../lib/format'
import { chartSummary } from '../lib/side-view-model'
import { useWorkspace } from '../stores/workspace-store-context'

const WIDTH = 396
const ROW_HEIGHT = 22
const LABEL_WIDTH = 88
const BAR_MAX = 200
const BAR_HEIGHT = 12

/**
 * Horizontal bars of the space in each age bucket, in the buckets' fixed order: the bucket on the
 * left, its size on the right, the bar as long as its share of the biggest bucket. "Unknown date"
 * is drawn in the muted colour. The picture is named by its three biggest buckets.
 */
export function AgeChart({ rows }: { rows: readonly AgeRow[] }) {
  const unit = useWorkspace((s) => s.unit)
  const lengths = barLengths(rows.map((row) => row.size))
  const summary = chartSummary(rows.map((row) => ({ label: row.label, value: row.size })))
  return (
    <svg
      role="img"
      aria-label={`Space by file age: ${summary}`}
      viewBox={`0 0 ${WIDTH} ${rows.length * ROW_HEIGHT}`}
      className="w-full max-w-[396px]"
    >
      {rows.map((row, i) => {
        const y = i * ROW_HEIGHT
        const length = lengths[i] ?? 0
        // A bucket with bytes always shows a bar, however small.
        const barWidth = row.size > 0 ? Math.max(2, length * BAR_MAX) : 0
        return (
          <g key={row.id}>
            <text x={0} y={y + 15} className="fill-ink text-xs">
              {row.label}
            </text>
            {barWidth > 0 && (
              <rect
                x={LABEL_WIDTH + 4}
                y={y + (ROW_HEIGHT - BAR_HEIGHT) / 2}
                width={barWidth}
                height={BAR_HEIGHT}
                rx={2}
                strokeWidth={1}
                className={`${row.id === 'unknown' ? 'fill-ink-subtle' : 'fill-bar-fill'} stroke-none forced-colors:stroke-[CanvasText]`}
              />
            )}
            <text x={WIDTH} y={y + 15} textAnchor="end" className="fill-ink-muted text-xs">
              {formatSize(row.size, unit)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
