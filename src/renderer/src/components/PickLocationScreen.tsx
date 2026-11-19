import { useEffect, useId, useRef } from 'react'
import { DRIVES_ERROR } from '../stores/scan-store'
import { useScanStore } from '../stores/scan-store-context'
import { Button } from './Button'
import { DriveCard } from './DriveCard'

export function PickLocationScreen() {
  const drives = useScanStore((s) => s.drives)
  const drivesStatus = useScanStore((s) => s.drivesStatus)
  const folderPickerOpen = useScanStore((s) => s.folderPickerOpen)
  const errorMessage = useScanStore((s) => s.errorMessage)
  const loadDrives = useScanStore((s) => s.loadDrives)
  const startScan = useScanStore((s) => s.startScan)
  const chooseFolder = useScanStore((s) => s.chooseFolder)
  const dismissError = useScanStore((s) => s.dismissError)
  const headingId = useId()
  const chooseButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void loadDrives()
  }, [loadDrives])

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-12"
    >
      <div className="flex flex-col gap-2">
        <h1 id={headingId} className="font-display text-2xl font-semibold tracking-tight">
          See what’s filling your disk
        </h1>
        <p className="text-ink-muted">
          Pick a drive or a folder. StorageIQ will show which folders take up the most space.
        </p>
      </div>

      {drivesStatus === 'error' ? (
        <p className="text-ink-muted">{DRIVES_ERROR}</p>
      ) : (
        <ul
          aria-label="Drives"
          className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3"
        >
          {drives.map((drive) => (
            <li key={drive.root}>
              <DriveCard drive={drive} onScan={() => void startScan(drive.root)} />
            </li>
          ))}
        </ul>
      )}

      <div>
        <Button
          ref={chooseButtonRef}
          variant="secondary"
          busy={folderPickerOpen}
          onClick={() => void chooseFolder()}
        >
          Choose folder…
        </Button>
      </div>

      {errorMessage !== null && (
        <div
          role="alert"
          className="flex w-full items-start justify-between gap-4 rounded-panel border border-danger/40 px-4 py-3 text-danger"
        >
          <p>{errorMessage}</p>
          <button
            type="button"
            onClick={() => {
              dismissError()
              chooseButtonRef.current?.focus()
            }}
            className="shrink-0 rounded-control px-2 py-0.5 font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  )
}
