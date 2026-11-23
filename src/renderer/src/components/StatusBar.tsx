import { useEffect, useState } from 'react'
import { formatBytes, formatCount } from '../lib/format'
import { ANNOUNCE_INTERVAL_MS, useThrottledAnnouncement } from '../lib/use-throttled-announcement'
import { useAppStore } from '../stores/app-store-context'
import { useWorkspace } from '../stores/workspace-store-context'
import { Dialog } from './Dialog'
import { UnreadableList, unreadableSummary } from './UnreadableList'

/**
 * Free space of the drive, files found (live), the excluded (unreadable) count that opens the
 * list, and the cluster size with the file system. Progress is announced at most every 5 s.
 */
export function StatusBar() {
  const phase = useWorkspace((s) => s.phase)
  const totals = useWorkspace((s) => s.totals)
  const errors = useWorkspace((s) => s.errors)
  const drive = useWorkspace((s) => s.drive)
  const announcement = useWorkspace((s) => s.announcement)
  const appInfo = useAppStore((s) => s.appInfo)
  const [showExcluded, setShowExcluded] = useState(false)

  const scanning = phase === 'scanning'
  const progressText =
    phase === 'empty'
      ? ''
      : scanning
        ? `${formatCount(totals.files)} files found so far.`
        : phase === 'failed'
          ? 'The scan stopped.'
          : `Scan finished: ${formatCount(totals.files)} files.`
  const announced = useThrottledAnnouncement(progressText, ANNOUNCE_INTERVAL_MS)
  const excluded = totals.errorCount

  // A new scan replaces the list the dialog shows.
  useEffect(() => {
    if (scanning) setShowExcluded(false)
  }, [scanning])

  return (
    <footer className="flex h-(--size-status-bar) items-center gap-4 border-t border-line bg-panel px-3 text-xs text-ink-muted tabular-nums">
      {drive !== null && (
        <span>
          Free space: {formatBytes(drive.freeBytes)} of {formatBytes(drive.totalBytes)}
        </span>
      )}
      {phase !== 'empty' && <span>{formatCount(totals.files)} files found</span>}
      {phase !== 'empty' &&
        (excluded > 0 && phase !== 'scanning' ? (
          <button
            type="button"
            onClick={() => setShowExcluded(true)}
            className="min-h-6 rounded-control px-1 underline underline-offset-2 hover:bg-row-hover"
          >
            {formatCount(excluded)} excluded
          </button>
        ) : (
          <span>{formatCount(excluded)} excluded</span>
        ))}
      {drive !== null && (
        <span>
          {formatCount(drive.clusterBytes)} bytes per cluster
          {drive.fileSystem !== '' ? ` (${drive.fileSystem})` : ''}
        </span>
      )}
      {appInfo !== null && <span className="ml-auto shrink-0">StorageIQ {appInfo.version}</span>}
      <span className="sr-only" aria-live="polite">
        {announced}
      </span>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {showExcluded && (
        <Dialog title={unreadableSummary(errors, excluded)} onClose={() => setShowExcluded(false)}>
          <UnreadableList errors={errors} errorCount={excluded} />
        </Dialog>
      )}
    </footer>
  )
}
