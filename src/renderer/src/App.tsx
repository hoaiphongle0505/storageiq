import { useEffect, useState } from 'react'
import { Banner } from './components/Banner'
import { AboutDialog } from './components/AboutDialog'
import { Ribbon } from './components/Ribbon'
import { Splitter } from './components/Splitter'
import { StatusBar } from './components/StatusBar'
import { TreeGrid } from './components/TreeGrid'
import { TreemapPane } from './components/TreemapPane'
import { UpdateBanner } from './components/UpdateBanner'
import { WhatsNewDialog } from './components/WhatsNewDialog'
import { useAppStore } from './stores/app-store-context'
import { useWorkspace } from './stores/workspace-store-context'

export const TREEMAP_DEFAULT_HEIGHT = 260
export const TREEMAP_MIN_HEIGHT = 120
export const TREEMAP_MAX_HEIGHT = 900
/** Window height kept for the ribbon, the tree and the status bar. */
const TREE_RESERVED_HEIGHT = 340

/** The analyzer workspace: ribbon, column tree, treemap pane and status bar, top to bottom. */
export function App() {
  const loadAppInfo = useAppStore((s) => s.loadAppInfo)
  const loadMenuData = useWorkspace((s) => s.loadMenuData)
  const treemapVisible = useWorkspace((s) => s.treemapVisible)
  const rescan = useWorkspace((s) => s.rescan)
  const whatsNew = useWorkspace((s) => s.whatsNew)
  const [treemapHeight, setTreemapHeight] = useState(TREEMAP_DEFAULT_HEIGHT)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight)

  useEffect(() => {
    const onResize = () => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // Keep room for the ribbon, the status bar and a usable tree above the treemap.
  const treemapMax = Math.max(
    TREEMAP_MIN_HEIGHT,
    Math.min(TREEMAP_MAX_HEIGHT, windowHeight - TREE_RESERVED_HEIGHT),
  )
  const shownHeight = Math.min(treemapHeight, treemapMax)

  useEffect(() => {
    void loadAppInfo()
    void loadMenuData()
  }, [loadAppInfo, loadMenuData])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F5') {
        event.preventDefault()
        // A held key, an open dialog or an open menu must not start a scan.
        if (event.repeat || document.querySelector('dialog[open], [role="menu"]') !== null) return
        void rescan()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rescan])

  return (
    <div className="flex h-full flex-col bg-app text-ink">
      <Ribbon onAbout={() => setAboutOpen(true)} />
      <Banner />
      <UpdateBanner />
      <main className="flex min-h-0 flex-1 flex-col">
        <TreeGrid />
        {treemapVisible && (
          <>
            <Splitter
              value={shownHeight}
              min={TREEMAP_MIN_HEIGHT}
              max={treemapMax}
              onChange={setTreemapHeight}
            />
            <TreemapPane height={shownHeight} />
          </>
        )}
      </main>
      <StatusBar />
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {whatsNew !== null && <WhatsNewDialog target={whatsNew} />}
    </div>
  )
}
