import { useWorkspace } from '../stores/workspace-store-context'
import { Button } from './Button'
import { Dialog } from './Dialog'

/** `E:\Games\` → `Games`; a drive root stays `E:\`. */
function leafOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const leaf = trimmed.slice(Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/')) + 1)
  return leaf === '' || /^[A-Za-z]:$/.test(leaf) ? path : leaf
}

/**
 * A `--scan` launch arrived while a scan is running: ask before replacing it. The safe choice,
 * keeping the current scan, has the focus and is what Escape does.
 */
export function LaunchScanDialog() {
  const pending = useWorkspace((s) => s.pendingLaunchScan)
  const current = useWorkspace((s) => s.target)
  const confirm = useWorkspace((s) => s.confirmLaunchScan)
  const decline = useWorkspace((s) => s.declineLaunchScan)
  if (pending === null) return null
  return (
    <Dialog
      title="Scan another folder?"
      onClose={decline}
      closeLabel="Keep current scan"
      actions={
        <Button variant="primary" onClick={() => void confirm()}>
          Scan {leafOf(pending)}
        </Button>
      }
    >
      <p className="text-[13px] leading-[18px] text-ink">
        StorageIQ is still scanning {current ?? 'a folder'}. Stop it and scan {pending} instead?
      </p>
    </Dialog>
  )
}
