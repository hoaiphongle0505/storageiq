import { type MouseEvent, useEffect, useRef, useState } from 'react'
import type { SizeMode, TreemapLayout } from '@shared/tree-types'
import { drawTreemap, hitTest, readTreemapColors } from '../lib/treemap-draw'
import { usePaneFolderName } from '../lib/use-pane-folder'
import { useWorkspace } from '../stores/workspace-store-context'
import { LevelBar } from './LevelBar'
import { PaneShell } from './PaneShell'
import { TreemapLegend } from './TreemapLegend'

interface Size {
  width: number
  height: number
}

/** A layout with the scan and Mode it was fetched for, so it is never drawn or hit with others. */
interface Shown {
  layout: TreemapLayout
  scanId: string
  mode: SizeMode
}

/**
 * The treemap of the selected folder, drawn on a canvas. The canvas is an image to assistive
 * technology: the folder tree above lists the same items with the same values and is the
 * accessible way to explore them (modern-web-guidance: canvas content needs an HTML
 * equivalent; the experimental canvas-html route is not used).
 */
export function TreemapPane({ height }: { height: number }) {
  const scanId = useWorkspace((s) => s.scanId)
  const treemapRootId = useWorkspace((s) => s.treemapRootId)
  const mode = useWorkspace((s) => s.mode)
  const unit = useWorkspace((s) => s.unit)
  const depth = useWorkspace((s) => s.treemapDepth)
  const revision = useWorkspace((s) => s.revision)
  const selectedId = useWorkspace((s) => s.selectedId)
  const fetchTreemap = useWorkspace((s) => s.fetchTreemap)
  const reveal = useWorkspace((s) => s.reveal)
  const drillInto = useWorkspace((s) => s.drillInto)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [shown, setShown] = useState<Shown | null>(null)
  const [failed, setFailed] = useState(false)
  const [themeVersion, setThemeVersion] = useState(0)

  useEffect(() => {
    const element = wrapperRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    // One layout request per animation frame while the pane is being resized.
    let frame = 0
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const next = {
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        setSize((old) => (old.width === next.width && old.height === next.height ? old : next)),
      )
    })
    observer.observe(element)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    // Colours and the contrast mode are read from the tokens at draw time: redraw when they change.
    const queries = [
      '(prefers-color-scheme: dark)',
      '(prefers-contrast: more)',
      '(forced-colors: active)',
    ].map((query) => window.matchMedia(query))
    const onChange = () => setThemeVersion((version) => version + 1)
    for (const query of queries) query.addEventListener('change', onChange)
    return () => {
      for (const query of queries) query.removeEventListener('change', onChange)
    }
  }, [])

  // Ask the scanner for a layout; only the newest answer is drawn.
  useEffect(() => {
    if (scanId === null || size.width < 1 || size.height < 1) {
      setShown(null)
      setFailed(false)
      return
    }
    let current = true
    fetchTreemap(size.width, size.height).then(
      (next) => {
        if (!current) return
        // The store answers null when the scanner could not lay the folder out.
        setShown(next === null ? null : { layout: next, scanId, mode })
        setFailed(next === null)
      },
      () => {
        if (!current) return
        setShown(null)
        setFailed(true)
      },
    )
    return () => {
      current = false
    }
  }, [scanId, treemapRootId, mode, depth, revision, size, fetchTreemap])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || shown === null) return
    const { layout } = shown
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(layout.width * ratio)
    canvas.height = Math.round(layout.height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawTreemap(ctx, layout, {
      colors: readTreemapColors(canvas),
      selectedId,
      mode: shown.mode,
      unit,
    })
  }, [shown, selectedId, unit, themeVersion])

  const pointOf = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  // A layout of another folder or scan (a reply still in flight) is shown but never clicked.
  const layout = shown?.layout ?? null
  const clickable =
    shown !== null && shown.scanId === scanId && shown.layout.nodeId === treemapRootId

  const folderName = usePaneFolderName()
  const title = folderName === null ? 'Treemap' : `Treemap of ${folderName}`

  return (
    <PaneShell height={height} label="Treemap" hideLabel="Hide treemap">
      <div ref={wrapperRef} className="relative min-h-0 flex-1 bg-(--treemap-edge)">
        {failed && (
          <p
            role="status"
            className="absolute inset-0 flex items-center justify-center px-4 text-ink-muted"
          >
            The treemap couldn’t be drawn. Choose another folder or scan again.
          </p>
        )}
        {layout !== null && (
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`${title}. The folder tree lists the same items.`}
            className="absolute inset-0 size-full"
            style={{ width: layout.width, height: layout.height }}
            onClick={(event) => {
              if (!clickable) return
              const { x, y } = pointOf(event)
              const hit = hitTest(layout, x, y)
              if (hit?.id) void reveal(hit.id)
            }}
            onDoubleClick={(event) => {
              if (!clickable) return
              const { x, y } = pointOf(event)
              const hit = hitTest(layout, x, y)
              if (hit?.id && hit.kind !== 'file' && hit.kind !== 'free') void drillInto(hit.id)
            }}
          />
        )}
      </div>
      <TreemapLegend layout={clickable ? layout : null} />
      <LevelBar />
    </PaneShell>
  )
}
