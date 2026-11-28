import type { ReactNode } from 'react'
import { useWorkspace } from '../stores/workspace-store-context'
import { BUTTON_VARIANT_CLASSES } from './Button'

/** The "Chart" button in the header of the Types and Age views: shows or hides their chart. */
export function ChartToggle() {
  const chartVisible = useWorkspace((s) => s.chartVisible)
  const toggleChart = useWorkspace((s) => s.toggleChart)
  return (
    <button
      type="button"
      aria-pressed={chartVisible}
      title={chartVisible ? 'Hide the chart' : 'Show the chart'}
      onClick={toggleChart}
      className={`h-6 rounded-control px-2 text-[13px] leading-[18px] font-medium transition-colors duration-[120ms] aria-pressed:bg-accent-subtle aria-pressed:text-accent ${BUTTON_VARIANT_CLASSES.quiet}`}
    >
      Chart
    </button>
  )
}

/**
 * A chart panel left of the table (below 720 px of pane width, above it). The panel is as wide as
 * a donut with its legend needs: 420 px. Hidden with the Chart toggle.
 */
export function ChartLayout({ chart, children }: { chart: ReactNode; children: ReactNode }) {
  const chartVisible = useWorkspace((s) => s.chartVisible)
  return (
    <div className="@container flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-auto @[720px]:flex-row @[720px]:overflow-hidden">
        {chartVisible && (
          <div className="shrink-0 border-b border-line p-3 @[720px]:w-[420px] @[720px]:overflow-auto @[720px]:border-r @[720px]:border-b-0">
            {chart}
          </div>
        )}
        <div className="flex min-h-40 min-w-0 flex-1 flex-col @[720px]:min-h-0">{children}</div>
      </div>
    </div>
  )
}
