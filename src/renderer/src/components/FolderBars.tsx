import { useId } from 'react'
import type { FolderSummary } from '@shared/scan-types'
import { formatBytes, formatCount, formatPercent, percentOf } from '../lib/format'

export const EVERYTHING_ELSE = 'Everything else'

export function FolderBars({
  label,
  rows,
  totalBytes,
  emptyText,
}: {
  label: string
  rows: FolderSummary[]
  totalBytes: number
  emptyText: string
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="font-semibold">
        {label}
      </h2>
      {rows.length === 0 ? (
        <p className="text-ink-muted">{emptyText}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row) => {
            const fraction = percentOf(row.bytes, totalBytes)
            const isFolder = row.kind === 'folder'
            return (
              <li
                key={isFolder ? row.path : 'everything-else'}
                className="grid grid-cols-[minmax(0,1fr)_6rem_3.5rem] items-center gap-x-3 gap-y-1"
              >
                <span className="truncate" title={isFolder ? row.path : undefined}>
                  {isFolder ? row.name : EVERYTHING_ELSE}
                </span>
                <span className="text-right tabular-nums" title={`${formatCount(row.bytes)} bytes`}>
                  {formatBytes(row.bytes)}
                </span>
                <span className="text-right text-ink-muted tabular-nums">
                  {formatPercent(fraction)}
                </span>
                <span
                  aria-hidden="true"
                  className="col-span-3 block h-1.5 overflow-hidden rounded-full bg-line"
                >
                  <span
                    className="block h-full bg-ink-muted"
                    style={{ width: `${fraction * 100}%` }}
                  />
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
