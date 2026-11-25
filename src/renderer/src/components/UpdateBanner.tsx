import { useWorkspace } from '../stores/workspace-store-context'
import { BANNER_ICONS, BANNER_VARIANT_CLASSES } from './Banner'
import { Button } from './Button'
import { downloadingText, UpdateProgress } from './UpdateProgress'

/**
 * A calm, non-modal strip when an update is found, downloading or ready. It is a polite status
 * message, not an alert, and never takes focus. The user decides: Update downloads, Restart to
 * update installs. A manual-check error is shown in About only, never here.
 */
export function UpdateBanner() {
  const updateState = useWorkspace((s) => s.updateState)
  const dismissed = useWorkspace((s) => s.dismissedUpdateVersion)
  const downloadUpdate = useWorkspace((s) => s.downloadUpdate)
  const installUpdate = useWorkspace((s) => s.installUpdate)
  const dismissUpdate = useWorkspace((s) => s.dismissUpdate)
  const openWhatsNew = useWorkspace((s) => s.openWhatsNew)

  const state = updateState
  if (state.kind !== 'available' && state.kind !== 'downloading' && state.kind !== 'ready') {
    return null
  }
  if (state.kind !== 'downloading' && dismissed === state.version) return null

  const Icon = BANNER_ICONS.info
  const whatsNew = (
    <Button
      variant="quiet"
      onClick={() => openWhatsNew({ kind: 'update', version: state.version })}
    >
      What&apos;s new
    </Button>
  )
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 border-b border-line px-4 py-2 ${BANNER_VARIANT_CLASSES.info}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon aria-hidden="true" focusable={false} className="shrink-0" />
        <p className="text-sm text-ink">
          {state.kind === 'available' && `StorageIQ ${state.version} is available.`}
          {state.kind === 'downloading' && downloadingText(state.version, state.percent)}
          {state.kind === 'ready' && `StorageIQ ${state.version} is ready. Restart to update.`}
        </p>
        {state.kind === 'downloading' && <UpdateProgress percent={state.percent} />}
      </div>
      {state.kind !== 'downloading' && (
        <div className="flex shrink-0 gap-2">
          {state.kind === 'available' ? (
            <Button onClick={() => void downloadUpdate()}>Update</Button>
          ) : (
            <Button onClick={() => void installUpdate()}>Restart to update</Button>
          )}
          {whatsNew}
          <Button variant="quiet" onClick={dismissUpdate}>
            Later
          </Button>
        </div>
      )}
    </div>
  )
}
