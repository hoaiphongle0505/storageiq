import {
  FILE_CATEGORIES,
  type FileCategory,
  type NodeId,
  type SizeMode,
  type TreemapLayout,
  type TreemapRect,
} from '@shared/tree-types'
import { filesRowName, formatCount, formatSize, type SizeUnit } from './format'

export type TreemapContrast = 'normal' | 'more' | 'forced'

/** Colours read from the CSS tokens at draw time, so the treemap follows light and dark. */
export interface TreemapColors {
  categories: Record<FileCategory, string>
  folder: string
  free: string
  freeHatch: string
  edge: string
  accent: string
  halo: string
  text: string
  cushionInner: string
  cushionOuter: string
  contrast: TreemapContrast
}

export const TREEMAP_FONT = '12px "Segoe UI Variable Small", "Segoe UI", system-ui, sans-serif'
export const TREEMAP_HEADER_FONT = '600 ' + TREEMAP_FONT
/** Blocks with both sides at least this long get cushion shading. */
export const CUSHION_MIN_SIDE = 12
/** Distance between free-space hatch lines, in px. */
export const HATCH_SPACING = 6
/** Height of the label strip the scanner leaves at the top of a nested block. */
const HEADER = 18
const MIN_LABEL_WIDTH = 36
const MIN_LABEL_HEIGHT = 16

/** Light-theme token values, used when a token is missing (tests, early paint). */
const FALLBACK_CATEGORIES: Record<FileCategory, string> = {
  video: '#eba48c',
  image: '#e9c46c',
  audio: '#d2a8dc',
  document: '#9dc3e8',
  archive: '#c3d282',
  code: '#8fd0bf',
  app: '#b2b6ec',
  system: '#b9c3ca',
  'disk-image': '#e8a8c0',
  other: '#d8d2c8',
}

function readContrast(): TreemapContrast {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'normal'
  if (window.matchMedia('(forced-colors: active)').matches) return 'forced'
  if (window.matchMedia('(prefers-contrast: more)').matches) return 'more'
  return 'normal'
}

export function readTreemapColors(element: Element): TreemapColors {
  const style = getComputedStyle(element)
  const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback
  const categories = { ...FALLBACK_CATEGORIES }
  for (const category of FILE_CATEGORIES) {
    categories[category] = token(`--treemap-${category}`, FALLBACK_CATEGORIES[category])
  }
  return {
    categories,
    folder: token('--treemap-folder', '#e6e1d8'),
    free: token('--treemap-free', '#f2ecdf'),
    freeHatch: token('--treemap-free-hatch', '#cfc6b4'),
    edge: token('--treemap-edge', '#f5f3ef'),
    accent: token('--accent', '#0d6b63'),
    halo: token('--treemap-halo', '#ffffff'),
    text: token('--ink', '#24211d'),
    cushionInner: token('--treemap-cushion-inner', 'rgba(255, 255, 255, 0.5)'),
    cushionOuter: token('--treemap-cushion-outer', 'rgba(255, 255, 255, 0)'),
    contrast: readContrast(),
  }
}

export function fillFor(rect: TreemapRect, colors: TreemapColors): string {
  if (colors.contrast === 'forced') return 'Canvas'
  if (rect.kind === 'free') return colors.free
  if (rect.nested || rect.category === null) return colors.folder
  return colors.categories[rect.category]
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

function hatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let offset = 0; offset < w + h; offset += HATCH_SPACING) {
    ctx.moveTo(x + offset - h, y + h)
    ctx.lineTo(x + offset, y)
  }
  ctx.stroke()
  ctx.restore()
}

function cushion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colors: TreemapColors,
) {
  const cx = x + 0.3 * w
  const cy = y + 0.25 * h
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.95 * Math.max(w, h))
  gradient.addColorStop(0, colors.cushionInner)
  gradient.addColorStop(1, colors.cushionOuter)
  ctx.fillStyle = gradient
  ctx.fillRect(x, y, w, h)
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
  const { contrast } = colors
  ctx.clearRect(0, 0, layout.width, layout.height)
  ctx.fillStyle =
    contrast === 'forced' ? 'CanvasText' : contrast === 'more' ? colors.text : colors.edge
  ctx.fillRect(0, 0, layout.width, layout.height)
  ctx.textBaseline = 'middle'
  let selected: { x: number; y: number; w: number; h: number } | null = null
  for (const rect of layout.rects) {
    if (rect.w < 2 || rect.h < 2) continue
    const x = rect.x + 1
    const y = rect.y + 1
    const w = rect.w - 2
    const h = rect.h - 2
    ctx.fillStyle = fillFor(rect, colors)
    ctx.fillRect(x, y, w, h)
    if (rect.kind === 'free' && contrast !== 'forced') hatch(ctx, x, y, w, h, colors.freeHatch)
    if (
      contrast === 'normal' &&
      rect.kind !== 'free' &&
      !rect.nested &&
      w >= CUSHION_MIN_SIDE &&
      h >= CUSHION_MIN_SIDE
    ) {
      cushion(ctx, x, y, w, h, colors)
    }
    if (rect.id !== null && rect.id === selectedId) selected = { x, y, w, h }
    if (rect.w < MIN_LABEL_WIDTH || rect.h < MIN_LABEL_HEIGHT) continue
    ctx.font = rect.nested ? TREEMAP_HEADER_FONT : TREEMAP_FONT
    const text = fitText(ctx, rectLabel(rect, mode, unit), rect.w - 8)
    if (text === null) continue
    ctx.fillStyle = contrast === 'forced' ? 'CanvasText' : colors.text
    const labelY = rect.nested
      ? rect.y + HEADER / 2 + 1
      : rect.y + Math.min(rect.h / 2, HEADER / 2 + 1)
    ctx.fillText(text, rect.x + 4, labelY)
  }
  if (selected !== null) {
    const { x, y, w, h } = selected
    if (contrast === 'forced') {
      ctx.strokeStyle = 'Highlight'
      ctx.lineWidth = 3
      ctx.strokeRect(x + 1.5, y + 1.5, Math.max(0, w - 3), Math.max(0, h - 3))
    } else {
      ctx.strokeStyle = colors.accent
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2))
      ctx.strokeStyle = colors.halo
      ctx.lineWidth = 1
      ctx.strokeRect(x + 3, y + 3, Math.max(0, w - 6), Math.max(0, h - 6))
    }
  }
}
