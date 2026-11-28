import type { ReactNode } from 'react'
import { IconDismiss } from '../lib/icons'
import { usePaneFolderName } from '../lib/use-pane-folder'
import { useWorkspace } from '../stores/workspace-store-context'
import { BUTTON_VARIANT_CLASSES } from './Button'
import { PANE_PANEL_ID, paneTabId, SideViewTabs } from './SideViewTabs'

/**
 * The frame every view of the bottom pane shares: a region named after the view, a header with
 * the tabs, the folder the view describes, the view's own actions and the hide button, and the
 * tab panel that holds the view.
 */
export function PaneShell({
  height,
  label,
  hideLabel = 'Hide pane',
  actions,
  children,
}: {
  height: number
  /** The region's name: the view's name. */
  label: string
  hideLabel?: string
  /** Buttons of the view, left of the hide button (for example "Copy as CSV"). */
  actions?: ReactNode
  children: ReactNode
}) {
  const paneTab = useWorkspace((s) => s.paneTab)
  const setTreemapVisible = useWorkspace((s) => s.setTreemapVisible)
  const folderName = usePaneFolderName()
  return (
    <section
      aria-label={label}
      className="flex shrink-0 flex-col border-t border-line bg-panel"
      style={{ height }}
    >
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3 text-[13px] leading-[18px]">
        <div className="flex min-w-0 items-center gap-3">
          <SideViewTabs />
          {folderName !== null && (
            <span className="min-w-0 truncate text-ink-muted">
              in{' '}
              <strong className="text-[15px] leading-5 font-semibold text-ink">{folderName}</strong>
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <button
            type="button"
            aria-label={hideLabel}
            title={hideLabel}
            onClick={() => setTreemapVisible(false)}
            className={`flex size-6 items-center justify-center rounded-control ${BUTTON_VARIANT_CLASSES.quiet} transition-colors duration-[120ms]`}
          >
            <IconDismiss aria-hidden="true" focusable={false} />
          </button>
        </div>
      </div>
      <div
        role="tabpanel"
        id={PANE_PANEL_ID}
        aria-labelledby={paneTabId(paneTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </div>
    </section>
  )
}
