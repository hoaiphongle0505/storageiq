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
      className="h-(--size-level-bar) shrink-0 border-t border-line bg-panel px-2 py-1"
    >
      <div className="grid size-full grid-cols-6 gap-0.5 rounded-pill bg-sunken p-0.5">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={depth === level}
            onClick={() => setTreemapDepth(level)}
            className="rounded-pill text-center text-[13px] leading-[18px] text-ink-muted tabular-nums transition-colors duration-[120ms] hover:bg-row-hover hover:text-ink aria-pressed:bg-raised aria-pressed:font-semibold aria-pressed:text-ink aria-pressed:shadow-[inset_0_0_0_1px_var(--accent),var(--elevation-raised)] aria-pressed:hover:bg-raised"
          >
            Level {level}
          </button>
        ))}
      </div>
    </div>
  )
}
