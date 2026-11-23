import { useWorkspace } from '../stores/workspace-store-context'
import { BANNER_ICONS, BANNER_VARIANT_CLASSES } from './Banner'
import { Button } from './Button'

/**
 * A calm, non-modal strip when an update has been downloaded. It is a polite status message,
 * not an alert, and never takes focus; the update also installs at the next normal quit.
 */
export function UpdateBanner() {
  const updateReady = useWorkspace((s) => s.updateReady)
  const installUpdate = useWorkspace((s) => s.installUpdate)
  const dismissUpdate = useWorkspace((s) => s.dismissUpdate)
  if (updateReady === null) return null
  const Icon = BANNER_ICONS.info
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 border-b border-line px-4 py-2 ${BANNER_VARIANT_CLASSES.info}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <p className="text-sm text-ink">
          StorageIQ {updateReady.version} is ready. Restart to update.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button onClick={() => void installUpdate()}>Restart</Button>
        <Button variant="quiet" onClick={dismissUpdate}>
          Later
        </Button>
      </div>
    </div>
  )
}
