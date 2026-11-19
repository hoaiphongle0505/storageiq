import { useEffect, useId, useRef } from 'react'
import { formatBytes, formatCount, formatDuration, middleTruncate } from '../lib/format'
import { ANNOUNCE_INTERVAL_MS, useThrottledAnnouncement } from '../lib/use-throttled-announcement'
import { useScanStore } from '../stores/scan-store-context'
import { Button } from './Button'
import { FolderBars } from './FolderBars'
import { Stat } from './Stat'

const CURRENT_PATH_MAX = 80

export function ScanningScreen() {
  const target = useScanStore((s) => s.target)
  const progress = useScanStore((s) => s.progress)
  const cancelScan = useScanStore((s) => s.cancelScan)
  const headingId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  const files = progress?.files ?? 0
  const folders = progress?.folders ?? 0
  const bytes = progress?.bytes ?? 0
  const currentPath = progress?.currentPath ?? target ?? ''
  const announcement = useThrottledAnnouncement(
    progress === null
      ? 'Scan started.'
      : `${formatCount(files)} files and ${formatCount(folders)} folders found, ${formatBytes(bytes)} so far.`,
    ANNOUNCE_INTERVAL_MS,
  )

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id={headingId} className="font-display text-2xl font-semibold tracking-tight">
            Scanning
          </h1>
          <p className="font-mono text-[13px] break-all text-ink-muted">{target}</p>
        </div>
        <Button ref={cancelRef} variant="secondary" onClick={() => void cancelScan()}>
          Cancel
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Files found" value={formatCount(files)} />
        <Stat label="Folders found" value={formatCount(folders)} />
        <Stat label="Size found" value={formatBytes(bytes)} />
        <Stat label="Elapsed" value={formatDuration(progress?.elapsedMs ?? 0)} />
      </dl>

      <p className="font-mono text-[13px] text-ink-muted" title={currentPath}>
        {middleTruncate(currentPath, CURRENT_PATH_MAX)}
      </p>

      <FolderBars
        label="Largest folders so far"
        rows={progress?.topFolders ?? []}
        totalBytes={bytes}
        emptyText="No folders found yet."
      />

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </section>
  )
}
