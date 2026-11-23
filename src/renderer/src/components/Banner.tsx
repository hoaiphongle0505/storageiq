import { type FluentIcon, IconError, IconInfo, IconSuccess, IconWarning } from '../lib/icons'
import { useWorkspace } from '../stores/workspace-store-context'
import { Button } from './Button'

export type BannerVariant = 'info' | 'danger' | 'warning' | 'success'

/** Strip background, 3 px tone stripe and icon colour per variant (shared with the update banner). */
export const BANNER_VARIANT_CLASSES: Record<BannerVariant, string> = {
  info: 'border-l-[3px] border-l-info bg-info-subtle text-info',
  danger: 'border-l-[3px] border-l-danger bg-danger-subtle text-danger',
  warning: 'border-l-[3px] border-l-warning bg-warning-subtle text-warning',
  success: 'border-l-[3px] border-l-success bg-success-subtle text-success',
}

export const BANNER_ICONS: Record<BannerVariant, FluentIcon> = {
  info: IconInfo,
  danger: IconError,
  warning: IconWarning,
  success: IconSuccess,
}

/** A problem above the tree: the scanner crashed (with Retry), or an action failed. */
export function Banner() {
  const banner = useWorkspace((s) => s.banner)
  const rescan = useWorkspace((s) => s.rescan)
  const dismissBanner = useWorkspace((s) => s.dismissBanner)
  if (banner === null) return null
  // A recoverable failure is calm (info); only a scanner crash is danger.
  const variant: BannerVariant = banner.tone === 'crash' ? 'danger' : 'info'
  const Icon = BANNER_ICONS[variant]
  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-4 border-b border-line px-4 py-2 ${BANNER_VARIANT_CLASSES[variant]}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Icon aria-hidden="true" focusable={false} className="shrink-0" />
        <p className="text-sm text-ink">{banner.message}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        {banner.tone === 'crash' && <Button onClick={() => void rescan()}>Retry</Button>}
        <Button variant="quiet" onClick={dismissBanner}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
