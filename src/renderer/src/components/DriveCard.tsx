import type { DriveInfo } from '@shared/scan-types'
import { formatBytes, percentOf } from '../lib/format'

export function DriveCard({ drive, onScan }: { drive: DriveInfo; onScan(): void }) {
  const letter = drive.root.slice(0, 2)
  const usedPercent = percentOf(drive.totalBytes - drive.freeBytes, drive.totalBytes) * 100
  return (
    <button
      type="button"
      onClick={onScan}
      className="flex w-full flex-col gap-2 rounded-panel border border-line bg-panel p-4 text-left hover:bg-sunken"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium">
          {drive.label} ({letter})
        </span>
        {drive.kind === 'removable' && (
          <span className="shrink-0 rounded-control border border-line px-1.5 text-xs font-semibold text-ink-muted">
            USB
          </span>
        )}
      </span>
      <span aria-hidden="true" className="block h-2 overflow-hidden rounded-full bg-line">
        <span className="block h-full bg-ink-muted" style={{ width: `${usedPercent}%` }} />
      </span>
      <span className="text-xs text-ink-muted tabular-nums">
        {formatBytes(drive.freeBytes)} free of {formatBytes(drive.totalBytes)}
      </span>
    </button>
  )
}
