import { CATEGORY_LABELS } from '@shared/file-category'
import type { FileCategory, TreemapLayout } from '@shared/tree-types'
import { formatBytes, formatShare } from '../lib/format'

export type LegendItem =
  | { kind: 'category'; category: FileCategory; label: string; share: number }
  | { kind: 'free'; label: 'Free space'; bytes: number }
  | { kind: 'mixed'; label: 'Mixed folders' }

/** File types of the laid-out folder by share, then free space and mixed folders when drawn. */
export function legendItems(layout: TreemapLayout): LegendItem[] {
  const total = layout.categories.reduce((sum, entry) => sum + entry.bytes, 0)
  const items: LegendItem[] = layout.categories.map((entry) => ({
    kind: 'category',
    category: entry.category,
    label: CATEGORY_LABELS[entry.category],
    share: total > 0 ? entry.bytes / total : 0,
  }))
  const free = layout.rects.find((rect) => rect.kind === 'free')
  if (free) items.push({ kind: 'free', label: 'Free space', bytes: free.value })
  const mixed = layout.rects.some(
    (rect) =>
      (rect.kind === 'folder' || rect.kind === 'files') && !rect.nested && rect.category === null,
  )
  if (mixed) items.push({ kind: 'mixed', label: 'Mixed folders' })
  return items
}

const SWATCH = 'size-2.5 shrink-0 rounded-[3px] border border-line-strong forced-colors:hidden'

function swatchStyle(item: LegendItem): { background: string } {
  if (item.kind === 'category') return { background: `var(--treemap-${item.category})` }
  if (item.kind === 'free') {
    return {
      background:
        'repeating-linear-gradient(45deg, var(--treemap-free-hatch) 0 1px, var(--treemap-free) 1px 4px)',
    }
  }
  return { background: 'var(--treemap-folder)' }
}

/** One row under the treemap that names the colours: file types with their shares. */
export function TreemapLegend({ layout }: { layout: TreemapLayout | null }) {
  const items = layout === null ? [] : legendItems(layout)
  return (
    <div className="h-(--size-treemap-legend) shrink-0 overflow-hidden">
      {items.length > 0 && (
        <ul
          aria-label="File types in this folder"
          className="flex size-full items-center gap-3 overflow-x-auto px-3 text-xs leading-4 font-small whitespace-nowrap tabular-nums"
        >
          {items.map((item) => (
            <li
              key={item.kind === 'category' ? item.category : item.kind}
              className="flex items-center gap-1.5"
            >
              <span aria-hidden="true" className={SWATCH} style={swatchStyle(item)} />
              <span className="text-ink">{item.label}</span>
              {item.kind === 'category' && (
                <span className="text-ink-muted">{formatShare(item.share)}</span>
              )}
              {item.kind === 'free' && (
                <span className="text-ink-muted">{formatBytes(item.bytes)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
