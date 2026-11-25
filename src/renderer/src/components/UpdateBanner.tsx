import { useEffect, useRef, useState } from 'react'
import { useUpdateFocus } from '../lib/use-update-focus'
import { useWorkspace } from '../stores/workspace-store-context'
import { BANNER_ICONS, BANNER_VARIANT_CLASSES } from './Banner'
import { Button } from './Button'
import { downloadingText, UpdateProgress } from './UpdateProgress'

/**
 * A calm, non-modal strip when an update is found, downloading or ready, or when a download
 * failed. It is a polite status message, not an alert, and never takes focus on its own. The user
 * decides: Update downloads, Restart to update installs. After a failed download, Try again
 * re-checks inside the banner: it stays mounted ("Checking for updates…") and shows a failed
 * re-check too. A manual check started elsewhere shows its error in About only.
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
  // True from Try again until the re-check ends in anything but a failure the user can retry.
  const [retrying, setRetrying] = useState(false)
  useEffect(() => {
    if (state.kind !== 'checking' && state.kind !== 'error') setRetrying(false)
  }, [state.kind])

  const downloadFailed = state.kind === 'error' && state.during === 'download'
  const recheckState = retrying && (state.kind === 'checking' || state.kind === 'error')
  if (recheckState) {
    // shown below
  } else if (state.kind !== 'available' && state.kind !== 'downloading' && state.kind !== 'ready') {
    if (!downloadFailed || dismissedError) return null
  } else if (state.kind !== 'downloading' && dismissed === state.version) {
    return null
  }

  const variant = state.kind === 'error' ? 'danger' : 'info'
  const Icon = BANNER_ICONS[variant]
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 border-b border-line px-4 py-2 ${BANNER_VARIANT_CLASSES[variant]}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon aria-hidden="true" focusable={false} className="shrink-0" />
        <p ref={textRef} tabIndex={-1} className="text-sm text-ink outline-none">
          {state.kind === 'checking' && 'Checking for updates…'}
          {state.kind === 'available' && `StorageIQ ${state.version} is available.`}
          {state.kind === 'downloading' && downloadingText(state.version, state.percent)}
          {state.kind === 'ready' && `StorageIQ ${state.version} is ready. Restart to update.`}
          {state.kind === 'error' && state.message}
        </p>
        {state.kind === 'downloading' && <UpdateProgress percent={state.percent} />}
      </div>
      {state.kind !== 'downloading' && state.kind !== 'checking' && (
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
            <Button
              onClick={() => {
                keepFocus()
                setRetrying(true)
                void checkForUpdates()
              }}
            >
              Try again
            </Button>
          )}
          {(state.kind === 'available' || state.kind === 'ready') && (
            <Button
              variant="quiet"
              onClick={() => openWhatsNew({ kind: 'update', version: state.version })}
            >
              What&apos;s new
            </Button>
          )}
          <Button
            variant="quiet"
            onClick={() => {
              if (retrying) setRetrying(false)
              dismissUpdate()
            }}
          >
            Later
          </Button>
        </div>
      )}
    </div>
  )
}
