import { useRef } from 'react'
import { MAX_TREEMAP_DEPTH } from '@shared/tree-types'
import { useFocusgroupFallback } from '../lib/use-focusgroup'
import { useWorkspace } from '../stores/workspace-store-context'

const LEVELS = Array.from({ length: MAX_TREEMAP_DEPTH + 1 }, (_, level) => level)

/** Treemap nesting depth, Level 0 (children only) to Level 5: one toggle per level. */
export function LevelBar() {
  const depth = useWorkspace((s) => s.treemapDepth)
  const setTreemapDepth = useWorkspace((s) => s.setTreemapDepth)
  const ref = useRef<HTMLDivElement>(null)
  useFocusgroupFallback(ref, 'toolbar')
  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Treemap levels"
      focusgroup="toolbar wrap"
      className="grid h-(--size-level-bar) shrink-0 grid-cols-6 gap-1 border-t border-line bg-sunken p-1"
    >
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={depth === level}
          onClick={() => setTreemapDepth(level)}
          className="min-h-6 rounded-control border border-line bg-panel px-2 text-left text-sm hover:bg-row-hover aria-pressed:border-accent aria-pressed:bg-pressed aria-pressed:font-semibold"
        >
          Level {level}
        </button>
      ))}
    </div>
  )
}
