import { useEffect, useId, useRef } from 'react'
import { formatBytes, formatCount, formatDuration } from '../lib/format'
import { useScanStore } from '../stores/scan-store-context'
import { Button } from './Button'
import { FolderBars } from './FolderBars'
import { Stat } from './Stat'
import { UnreadableList } from './UnreadableList'

export function ResultScreen() {
  const result = useScanStore((s) => s.result)
  const target = useScanStore((s) => s.target)
  const rescan = useScanStore((s) => s.rescan)
  const chooseAnotherLocation = useScanStore((s) => s.chooseAnotherLocation)
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const scanId = result?.scanId

  // The Cancel button that had focus is gone; move focus to the result heading.
  useEffect(() => {
    headingRef.current?.focus()
  }, [scanId])

  if (result === null) return null
  const canceled = result.status === 'canceled'

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            ref={headingRef}
            id={headingId}
            tabIndex={-1}
            className="font-display text-2xl font-semibold tracking-tight focus:outline-none"
          >
            {canceled ? 'Scan canceled — partial results' : 'Scan complete'}
          </h1>
          <p className="font-mono text-[13px] break-all text-ink-muted">{target}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void rescan()}>Scan again</Button>
          <Button variant="secondary" onClick={chooseAnotherLocation}>
            Choose another location
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-4 gap-4">
        <Stat
          label="Total size"
          value={formatBytes(result.bytes)}
          title={`${formatCount(result.bytes)} bytes`}
        />
        <Stat label="Files" value={formatCount(result.files)} />
        <Stat label="Folders" value={formatCount(result.folders)} />
        <Stat label="Scan time" value={formatDuration(result.elapsedMs)} />
      </dl>

      <FolderBars
        label="Largest folders"
        rows={result.topFolders}
        totalBytes={result.bytes}
        emptyText="This location has no folders."
      />

      {result.errorCount > 0 && (
        <UnreadableList errors={result.errors} errorCount={result.errorCount} />
      )}
    </section>
  )
}
