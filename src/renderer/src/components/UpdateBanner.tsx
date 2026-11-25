import { useRef } from 'react'
import { useUpdateFocus } from '../lib/use-update-focus'
import { useWorkspace } from '../stores/workspace-store-context'
import { BANNER_ICONS, BANNER_VARIANT_CLASSES } from './Banner'
import { Button } from './Button'
import { downloadingText, UpdateProgress } from './UpdateProgress'

/**
 * A calm, non-modal strip when an update is found, downloading or ready, or when a download
 * failed. It is a polite status message, not an alert, and never takes focus on its own. The user
 * decides: Update downloads, Restart to update installs. A manual-check error is shown in About
 * only, never here.
 */
export function UpdateBanner() {
  const state = useWorkspace((s) => s.updateState)
  const dismissed = useWorkspace((s) => s.dismissedUpdateVersion)
  const dismissedError = useWorkspace((s) => s.dismissedDownloadError)
  const downloadUpdate = useWorkspace((s) => s.downloadUpdate)
  const checkForUpdates = useWorkspace((s) => s.checkForUpdates)
  const installUpdate = useWorkspace((s) => s.installUpdate)
  const dismissUpdate = useWorkspace((s) => s.dismissUpdate)
  const openWhatsNew = useWorkspace((s) => s.openWhatsNew)
  const textRef = useRef<HTMLParagraphElement>(null)
  const restartRef = useRef<HTMLButtonElement>(null)
  const keepFocus = useUpdateFocus(state.kind, textRef, restartRef)

  const downloadFailed = state.kind === 'error' && state.during === 'download'
  if (state.kind !== 'available' && state.kind !== 'downloading' && state.kind !== 'ready') {
    if (!downloadFailed || dismissedError) return null
  } else if (state.kind !== 'downloading' && dismissed === state.version) {
    return null
  }

  const Icon = BANNER_ICONS.info
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 border-b border-line px-4 py-2 ${BANNER_VARIANT_CLASSES.info}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon aria-hidden="true" focusable={false} className="shrink-0" />
        <p ref={textRef} tabIndex={-1} className="text-sm text-ink outline-none">
          {state.kind === 'available' && `StorageIQ ${state.version} is available.`}
          {state.kind === 'downloading' && downloadingText(state.version, state.percent)}
          {state.kind === 'ready' && `StorageIQ ${state.version} is ready. Restart to update.`}
          {state.kind === 'error' && state.message}
        </p>
        {state.kind === 'downloading' && <UpdateProgress percent={state.percent} />}
      </div>
      {state.kind !== 'downloading' && (
        <div className="flex shrink-0 gap-2">
          {state.kind === 'available' && (
            <Button
              onClick={() => {
                keepFocus()
                void downloadUpdate()
              }}
            >
              Update
            </Button>
          )}
          {state.kind === 'ready' && (
            <Button ref={restartRef} onClick={() => void installUpdate()}>
              Restart to update
            </Button>
          )}
          {state.kind === 'error' && (
            <Button onClick={() => void checkForUpdates()}>Try again</Button>
          )}
          {(state.kind === 'available' || state.kind === 'ready') && (
            <Button
              variant="quiet"
              onClick={() => openWhatsNew({ kind: 'update', version: state.version })}
            >
              What&apos;s new
            </Button>
          )}
          <Button variant="quiet" onClick={dismissUpdate}>
            Later
          </Button>
        </div>
      )}
    </div>
  )
}
