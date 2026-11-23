import type { NodeId, SizeMode, TreemapLayout, TreemapRect } from '@shared/tree-types'
import { filesRowName, formatCount, formatSize, type SizeUnit } from './format'

/** Colours read from the CSS tokens at draw time, so the treemap follows light and dark. */
export interface TreemapColors {
  levels: [string, string, string]
  files: string
  free: string
  edge: string
  outline: string
  text: string
}

export const TREEMAP_FONT = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
/** Height of the label strip the scanner leaves at the top of a nested block. */
const HEADER = 18
const MIN_LABEL_WIDTH = 36
const MIN_LABEL_HEIGHT = 16

export function readTreemapColors(element: Element): TreemapColors {
  const style = getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  return {
    levels: [
      token('--treemap-0', '#c6e3df'),
      token('--treemap-1', '#a9d4cf'),
      token('--treemap-2', '#8fc6c0'),
    ],
    files: token('--treemap-files', '#e1e6e6'),
    free: token('--treemap-free', '#f3e6c9'),
    edge: token('--treemap-edge', '#f6f7f7'),
    outline: token('--treemap-outline', '#1b2122'),
    text: token('--text', '#1b2122'),
  }
}

export function fillFor(rect: TreemapRect, colors: TreemapColors): string {
  if (rect.kind === 'free') return colors.free
  if (rect.kind === 'files' || rect.kind === 'file') return colors.files
  return colors.levels[rect.depth % 3] ?? colors.levels[0]
}

/** `Photos (12.3 GB)`, `[7 files] (59.5 GB)`, `Free space (45.7 GB)`. */
export function rectLabel(rect: TreemapRect, mode: SizeMode, unit: SizeUnit): string {
  const name = rect.kind === 'files' ? filesRowName(rect.files) : rect.name
  const value = mode === 'files' ? `${formatCount(rect.value)} files` : formatSize(rect.value, unit)
  return `${name} (${value})`
}

/** The deepest block under a point (nested blocks are drawn after their parent). */
export function hitTest(layout: TreemapLayout, x: number, y: number): TreemapRect | null {
  for (let i = layout.rects.length - 1; i >= 0; i -= 1) {
    const rect = layout.rects[i]
    if (rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h)
      return rect
  }
  return null
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string | null {
  if (ctx.measureText(text).width <= maxWidth) return text
  for (let length = text.length - 1; length > 1; length -= 1) {
    const candidate = `${text.slice(0, length)}…`
    if (ctx.measureText(candidate).width <= maxWidth) return candidate
  }
  return null
}

/** Draws the layout in CSS pixels (the caller scales the context for the device pixel ratio). */
export function drawTreemap(
  ctx: CanvasRenderingContext2D,
  layout: TreemapLayout,
  options: {
    colors: TreemapColors
    selectedId: NodeId | null
    mode: SizeMode
    unit: SizeUnit
  },
): void {
  const { colors, selectedId, mode, unit } = options
  ctx.clearRect(0, 0, layout.width, layout.height)
  ctx.font = TREEMAP_FONT
  ctx.textBaseline = 'middle'
  let selected: TreemapRect | null = null
  for (const rect of layout.rects) {
    ctx.fillStyle = fillFor(rect, colors)
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    ctx.strokeStyle = colors.edge
    ctx.lineWidth = 1
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, Math.max(0, rect.w - 1), Math.max(0, rect.h - 1))
    if (rect.id !== null && rect.id === selectedId) selected = rect
    if (rect.w < MIN_LABEL_WIDTH || rect.h < MIN_LABEL_HEIGHT) continue
    const text = fitText(ctx, rectLabel(rect, mode, unit), rect.w - 8)
    if (text === null) continue
    ctx.fillStyle = colors.text
    const labelY = rect.nested
      ? rect.y + HEADER / 2 + 1
      : rect.y + Math.min(rect.h / 2, HEADER / 2 + 1)
    ctx.fillText(text, rect.x + 4, labelY)
  }
  if (selected !== null) {
    ctx.strokeStyle = colors.outline
    ctx.lineWidth = 2
    ctx.strokeRect(
      selected.x + 1,
      selected.y + 1,
      Math.max(0, selected.w - 2),
      Math.max(0, selected.h - 2),
    )
  }
}
