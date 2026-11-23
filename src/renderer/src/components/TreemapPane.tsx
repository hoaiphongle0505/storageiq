import { X } from 'lucide-react'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import type { TreemapLayout } from '@shared/tree-types'
import { rowName } from '../lib/format'
import { drawTreemap, hitTest, readTreemapColors } from '../lib/treemap-draw'
import { useWorkspace } from '../stores/workspace-store-context'
import { LevelBar } from './LevelBar'

interface Size {
  width: number
  height: number
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
  const lists = useWorkspace((s) => s.lists)
  const fetchTreemap = useWorkspace((s) => s.fetchTreemap)
  const reveal = useWorkspace((s) => s.reveal)
  const drillInto = useWorkspace((s) => s.drillInto)
  const setTreemapVisible = useWorkspace((s) => s.setTreemapVisible)

  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [layout, setLayout] = useState<TreemapLayout | null>(null)
  const [themeVersion, setThemeVersion] = useState(0)

  useEffect(() => {
    const element = wrapperRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query) return
    const onChange = () => setThemeVersion((version) => version + 1)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Ask the scanner for a layout; only the newest answer is drawn.
  useEffect(() => {
    if (scanId === null || size.width < 1 || size.height < 1) {
      setLayout(null)
      return
    }
    let current = true
    fetchTreemap(size.width, size.height).then(
      (next) => {
        if (current) setLayout(next)
      },
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [scanId, treemapRootId, mode, depth, revision, size, fetchTreemap])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || layout === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(layout.width * ratio)
    canvas.height = Math.round(layout.height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    drawTreemap(ctx, layout, { colors: readTreemapColors(canvas), selectedId, mode, unit })
  }, [layout, selectedId, mode, unit, themeVersion])

  const pointOf = (event: MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const rootRow =
    treemapRootId === null
      ? null
      : (lists[treemapRootId]?.parent ??
        Object.values(lists)
          .flatMap((list) => Object.values(list.chunks).flatMap((chunk) => chunk.rows))
          .find((row) => row.id === treemapRootId) ??
        null)
  const title = rootRow === null ? 'Treemap' : `Treemap of ${rowName(rootRow)}`

  return (
    <section
      aria-label="Treemap"
      className="flex shrink-0 flex-col border-t border-line bg-panel"
      style={{ height }}
    >
      <div className="flex h-7 items-center justify-between gap-2 border-b border-line px-2 text-sm">
        <span className="min-w-0 truncate text-ink-muted">{title}</span>
        <button
          type="button"
          aria-label="Hide treemap"
          title="Hide treemap"
          onClick={() => setTreemapVisible(false)}
          className="flex size-6 items-center justify-center rounded-control hover:bg-row-hover"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div ref={wrapperRef} className="relative min-h-0 flex-1">
        {layout !== null && (
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`${title}. The folder tree lists the same items.`}
            className="absolute inset-0 size-full"
            style={{ width: layout.width, height: layout.height }}
            onClick={(event) => {
              const { x, y } = pointOf(event)
              const hit = hitTest(layout, x, y)
              if (hit?.id) void reveal(hit.id)
            }}
            onDoubleClick={(event) => {
              const { x, y } = pointOf(event)
              const hit = hitTest(layout, x, y)
              if (hit?.id && hit.kind !== 'file' && hit.kind !== 'free') void drillInto(hit.id)
            }}
          />
        )}
      </div>
      <LevelBar />
    </section>
  )
}
