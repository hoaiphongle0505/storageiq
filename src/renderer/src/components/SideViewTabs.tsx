import { useLayoutEffect, useRef } from 'react'
import { useFocusgroupFallback } from '../lib/use-focusgroup'
import type { PaneTab } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'

export const PANE_TABS: ReadonlyArray<{ id: PaneTab; label: string }> = [
  { id: 'treemap', label: 'Treemap' },
  { id: 'top', label: 'Top files' },
  { id: 'types', label: 'Types' },
  { id: 'age', label: 'Age' },
]

/** The one tab panel of the bottom pane: whichever view is shown. */
export const PANE_PANEL_ID = 'pane-panel'

/**
 * Each view renders its own tab list, so a tab change remounts it and drops the focus; the tab that
 * took focus is remembered here and focused again by the new tab list.
 */
let refocusTab: PaneTab | null = null

export function paneTabId(tab: PaneTab): string {
  return `pane-tab-${tab}`
}

/**
 * The tabs of the bottom pane (WAI-ARIA tabs, modern-web-guidance "tabs"): one tab stop, arrow
 * keys move between the tabs and show each view at once, Home and End jump to the ends. Before a
 * scan the tabs are `aria-disabled`: they stay reachable and ignore clicks, like the ribbon's
 * disabled commands.
 */
export function SideViewTabs() {
  const paneTab = useWorkspace((s) => s.paneTab)
  const hasScan = useWorkspace((s) => s.scanId !== null)
  const setPaneTab = useWorkspace((s) => s.setPaneTab)
  const ref = useRef<HTMLDivElement>(null)
  useFocusgroupFallback(ref, 'tablist', paneTab)
  useLayoutEffect(() => {
    if (refocusTab !== null) document.getElementById(paneTabId(refocusTab))?.focus()
    refocusTab = null
  }, [])
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label="Pane views"
      focusgroup="tablist nomemory"
      className="flex items-end gap-0.5"
    >
      {PANE_TABS.map((tab) => (
        <button
          key={tab.id}
          id={paneTabId(tab.id)}
          type="button"
          role="tab"
          aria-selected={paneTab === tab.id}
          aria-controls={PANE_PANEL_ID}
          aria-disabled={hasScan ? undefined : 'true'}
          onClick={() => {
            if (hasScan) setPaneTab(tab.id)
          }}
          onFocus={() => {
            if (!hasScan || tab.id === paneTab) return
            refocusTab = tab.id
            setPaneTab(tab.id)
          }}
          className="relative min-h-6 rounded-control px-2.5 text-[13px] leading-[18px] font-medium text-ink-muted transition-colors duration-[120ms] after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-[1px] after:bg-accent after:opacity-0 hover:bg-row-hover hover:text-ink aria-disabled:cursor-default aria-disabled:text-ink-subtle aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-subtle aria-selected:font-semibold aria-selected:text-ink aria-selected:after:opacity-100 forced-colors:aria-selected:underline forced-colors:aria-selected:decoration-2 forced-colors:aria-selected:decoration-[Highlight] forced-colors:aria-selected:underline-offset-4"
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
