import { useWorkspace } from '../stores/workspace-store-context'
import { Button } from './Button'

/** A problem above the tree: the scanner crashed (with Retry), or an action failed. */
export function Banner() {
  const banner = useWorkspace((s) => s.banner)
  const rescan = useWorkspace((s) => s.rescan)
  const dismissBanner = useWorkspace((s) => s.dismissBanner)
  if (banner === null) return null
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 border-b border-danger/40 bg-panel px-4 py-2 text-danger"
    >
      <p>{banner.message}</p>
      <div className="flex shrink-0 gap-2">
        {banner.tone === 'crash' && <Button onClick={() => void rescan()}>Retry</Button>}
        <Button variant="secondary" onClick={dismissBanner}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
