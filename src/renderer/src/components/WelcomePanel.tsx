import { useId } from 'react'
import { useAppStore } from '../stores/app-store-context'

export function WelcomePanel() {
  const scanTarget = useAppStore((s) => s.scanTarget)
  const folderPickerOpen = useAppStore((s) => s.folderPickerOpen)
  const errorMessage = useAppStore((s) => s.errorMessage)
  const chooseFolder = useAppStore((s) => s.chooseFolder)
  const dismissError = useAppStore((s) => s.dismissError)
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-8 py-16"
    >
      <h1 id={headingId} className="font-display text-2xl font-semibold tracking-tight">
        See what’s filling your disk
      </h1>
      <p className="text-ink-muted">
        Choose a folder and StorageIQ will show which folders and files take up the most space.
      </p>

      {scanTarget !== null && (
        <div className="w-full rounded-panel border border-line bg-panel px-4 py-3">
          <p className="text-xs font-medium text-ink-muted">Selected folder</p>
          <p className="mt-1 font-mono text-[13px] break-all">{scanTarget}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void chooseFolder()}
        disabled={folderPickerOpen}
        className="rounded-control bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:cursor-default disabled:opacity-60"
      >
        {scanTarget === null ? 'Choose folder' : 'Choose a different folder'}
      </button>

      {errorMessage !== null && (
        <div
          role="alert"
          className="flex w-full items-start justify-between gap-4 rounded-panel border border-danger/40 px-4 py-3 text-danger"
        >
          <p>{errorMessage}</p>
          <button
            type="button"
            onClick={dismissError}
            className="shrink-0 rounded-control px-2 py-0.5 font-medium underline-offset-2 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  )
}
