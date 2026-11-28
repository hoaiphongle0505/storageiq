import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { NodeId, TopFileRow } from '@shared/tree-types'
import { topFilesCsv } from '../lib/csv'
import { formatCount, formatDate, formatSize, middleTruncate } from '../lib/format'
import { useIconCache } from '../lib/icon-cache-context'
import { extendBy, rangeTo, selectAll, type Selection, single, toggle } from '../lib/selection'
import { useSideView } from '../lib/use-side-view'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'
import { CopyCsvButton } from './CopyCsvButton'
import { FileIcon } from './FileIcon'
import { PaneShell } from './PaneShell'
import { ScanningNote } from './SideViewParts'
import { SINGLE_ITEM_MESSAGE, TREE_ROW_HEIGHT } from './TreeGrid'

const OVERSCAN = 10
/** The folder column is shortened in the middle to this many characters. */
const FOLDER_CHARS = 48
const NO_ROWS: TopFileRow[] = []
const NO_SELECTION: Selection = { ids: new Set(), activeId: null, anchorId: null }

export const NO_FILES_TEXT = 'There are no files in this folder.'

const GRID_TEMPLATE =
  'minmax(var(--size-col-name-min),1.2fr) var(--size-col-size) var(--size-col-allocated) var(--size-col-modified) minmax(160px,1fr)'

const COLUMNS = ['Name', 'Size', 'Allocated', 'Modified', 'Folder'] as const
const NUMERIC = new Set<string>(['Size', 'Allocated'])

export function topRowDomId(id: NodeId): string {
  return `top-row-${id}`
}

/**
 * The largest files below the treemap folder (up to 1,000), as an ARIA grid virtualized by hand
 * like the folder tree. The Mode decides the ranking (Allocated by allocated size, the others by
 * size). Selection and keys follow the tree's: click, Ctrl+click and Shift+click; arrows, Home,
 * End, PageUp and PageDown (Shift extends, Ctrl moves only the focus); Space, Ctrl+A and Esc;
 * Enter shows the file in Explorer; Shift+F10, the Menu key and right-click open the Explorer
 * menu; Ctrl+C copies the paths. Double-click reveals the file in the folder tree.
 */
export function TopFilesView({ height }: { height: number }) {
  const scanId = useWorkspace((s) => s.scanId)
  const mode = useWorkspace((s) => s.mode)
  const unit = useWorkspace((s) => s.unit)
  const fetchTopFiles = useWorkspace((s) => s.fetchTopFiles)
  const reveal = useWorkspace((s) => s.reveal)
  const announce = useWorkspace((s) => s.announce)
  const openInExplorer = useWorkspace((s) => s.openInExplorer)
  const showContextMenu = useWorkspace((s) => s.showContextMenu)
  const copyPaths = useWorkspace((s) => s.copyPaths)

  const state = useSideView(fetchTopFiles, mode)
  const rows = state.status === 'ready' ? state.rows : NO_ROWS
  const ids = useMemo(() => rows.map((row) => row.id), [rows])

  const iconCache = useIconCache()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(400)
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)

  const first = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    rows.length - 1,
    Math.ceil((scrollTop + viewport) / TREE_ROW_HEIGHT) + OVERSCAN,
  )

  useEffect(() => {
    const element = scrollRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewport(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Windows' icons for the rendered rows; the cache batches and dedupes.
  useEffect(() => {
    if (scanId === null || iconCache === null) return
    iconCache.request(scanId, ids.slice(first, last + 1))
  }, [scanId, iconCache, ids, first, last])

  const activeIndex = selection.activeId === null ? -1 : ids.indexOf(selection.activeId)

  const ensureVisible = (index: number) => {
    const element = scrollRef.current
    if (element === null || index < 0) return
    const top = index * TREE_ROW_HEIGHT
    const visible = element.clientHeight || viewport
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + TREE_ROW_HEIGHT > element.scrollTop + visible) {
      element.scrollTop = top + TREE_ROW_HEIGHT - visible
    }
    setScrollTop(element.scrollTop)
  }

  /** The rows an action takes: the selected rows in list order, or the active row alone. */
  const actionIds = (): NodeId[] => {
    const selected = ids.filter((id) => selection.ids.has(id))
    if (selected.length > 0) return selected
    return selection.activeId === null ? [] : [selection.activeId]
  }

  const moveTo = (index: number, event: KeyboardEvent<HTMLDivElement>) => {
    const clamped = Math.max(0, Math.min(ids.length - 1, index))
    const id = ids[clamped]
    if (id === undefined) return
    if (event.shiftKey && event.ctrlKey) setSelection(rangeTo(selection, ids, id, true))
    else if (event.shiftKey) setSelection(rangeTo(selection, ids, id, false))
    else if (event.ctrlKey) setSelection({ ...selection, activeId: id })
    else setSelection(single(id))
    ensureVisible(clamped)
  }

  const openMenuForActive = () => {
    if (selection.activeId === null) return
    const rect = document.getElementById(topRowDomId(selection.activeId))?.getBoundingClientRect()
    void showContextMenu(actionIds(), (rect?.left ?? 0) + 32, rect?.bottom ?? 0, false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || ids.length === 0) return
    const pageRows = Math.max(1, Math.floor(viewport / TREE_ROW_HEIGHT) - 1)
    const several = selection.ids.size > 1
    const key = event.key
    let handled = true
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      const delta = key === 'ArrowDown' ? 1 : -1
      if (event.shiftKey && !event.ctrlKey) {
        setSelection(extendBy(selection, ids, delta))
        ensureVisible(activeIndex + delta)
      } else moveTo(activeIndex === -1 ? 0 : activeIndex + delta, event)
    } else if (key === 'Home') moveTo(0, event)
    else if (key === 'End') moveTo(ids.length - 1, event)
    else if (key === 'PageDown') moveTo(activeIndex + pageRows, event)
    else if (key === 'PageUp') moveTo(activeIndex - pageRows, event)
    else if (key === ' ' && selection.activeId !== null) {
      setSelection(toggle(selection, selection.activeId))
    } else if (event.ctrlKey && key.toLowerCase() === 'a') {
      setSelection(selectAll(ids, selection))
    } else if (key === 'Escape') {
      if (several && selection.activeId !== null) setSelection(single(selection.activeId))
      else handled = false
    } else if (key === 'Enter' && selection.activeId !== null) {
      if (several) announce(SINGLE_ITEM_MESSAGE)
      else void openInExplorer(selection.activeId)
    } else if ((key === 'F10' && event.shiftKey) || key === 'ContextMenu') {
      openMenuForActive()
    } else if (event.ctrlKey && key.toLowerCase() === 'c' && selection.activeId !== null) {
      void copyPaths(actionIds())
    } else handled = false
    if (handled) event.preventDefault()
  }

  const onRowClick = (id: NodeId, event: MouseEvent) => {
    const additive = event.ctrlKey || event.metaKey
    if (event.shiftKey) setSelection(rangeTo(selection, ids, id, additive))
    else if (additive) setSelection(toggle(selection, id))
    else setSelection(single(id))
  }

  const onRowContextMenu = (id: NodeId, event: MouseEvent) => {
    event.preventDefault()
    let sent: NodeId[]
    if (selection.ids.has(id)) {
      // Inside the selection: the menu acts on all of it; the clicked row becomes the active one.
      setSelection({ ...selection, activeId: id })
      sent = ids.filter((candidate) => selection.ids.has(candidate))
    } else {
      setSelection(single(id))
      sent = [id]
    }
    void showContextMenu(sent, event.clientX, event.clientY, event.shiftKey)
  }

  const lines: ReactNode[] = []
  for (let i = first; i <= last; i += 1) {
    const row = rows[i]
    if (row === undefined) continue
    const selected = selection.ids.has(row.id)
    lines.push(
      <div
        key={row.id}
        id={topRowDomId(row.id)}
        role="row"
        aria-rowindex={i + 2}
        aria-selected={selected}
        data-active={row.id === selection.activeId ? 'true' : undefined}
        onClick={(event) => onRowClick(row.id, event)}
        onDoubleClick={(event) => {
          if (event.shiftKey || event.ctrlKey || event.metaKey) return
          void reveal(row.id)
        }}
        onContextMenu={(event) => onRowContextMenu(row.id, event)}
        className={`absolute inset-x-0 grid cursor-default items-center tabular-nums select-none ${
          selected ? 'bg-selection shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-row-hover'
        }`}
        style={{
          gridTemplateColumns: GRID_TEMPLATE,
          height: TREE_ROW_HEIGHT,
          transform: `translateY(${i * TREE_ROW_HEIGHT}px)`,
        }}
      >
        <div role="gridcell" className="flex min-w-0 items-center gap-2 px-3">
          <FileIcon row={{ id: row.id, kind: 'file', name: row.name }} root={false} />
          <span className="min-w-0 truncate" title={row.name}>
            {row.name}
          </span>
        </div>
        <div
          role="gridcell"
          className="pr-3 text-right"
          data-bytes={row.size}
          title={`${formatCount(row.size)} bytes`}
        >
          {formatSize(row.size, unit)}
        </div>
        <div
          role="gridcell"
          className="pr-3 text-right"
          data-bytes={row.allocated}
          title={`${formatCount(row.allocated)} bytes`}
        >
          {formatSize(row.allocated, unit)}
        </div>
        <div role="gridcell" className="truncate pr-2">
          {formatDate(row.modifiedMs)}
        </div>
        <div role="gridcell" className="truncate pr-3 text-ink-muted" title={row.folder}>
          {middleTruncate(row.folder, FOLDER_CHARS)}
        </div>
      </div>,
    )
  }

  const ranked = mode === 'allocated' ? 'Allocated' : 'Size'
  const activeRendered = activeIndex >= first && activeIndex <= last
  const message =
    state.status === 'gone'
      ? GONE_MESSAGE
      : state.status === 'ready' && rows.length === 0
        ? NO_FILES_TEXT
        : null

  return (
    <PaneShell
      height={height}
      label="Top files"
      actions={<CopyCsvButton build={() => topFilesCsv(rows)} rows={rows.length} />}
    >
      <ScanningNote />
      <div
        role="grid"
        aria-label="Largest files"
        aria-rowcount={rows.length + 1}
        aria-colcount={COLUMNS.length}
        aria-multiselectable="true"
        aria-activedescendant={
          activeRendered && selection.activeId !== null
            ? topRowDomId(selection.activeId)
            : undefined
        }
        tabIndex={0}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        className="flex min-h-0 flex-1 flex-col focus-visible:outline-offset-[-2px]"
      >
        <div role="rowgroup" className="border-b border-line bg-panel">
          <div
            role="row"
            aria-rowindex={1}
            className="grid h-(--size-header-row) items-stretch text-[13px] leading-[18px]"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            {COLUMNS.map((column) => (
              <div
                key={column}
                role="columnheader"
                aria-sort={column === ranked ? 'descending' : undefined}
                className={`flex items-center gap-1 px-3 ${column === ranked ? 'font-semibold text-ink' : 'font-medium text-ink-muted'} ${NUMERIC.has(column) ? 'justify-end' : ''}`}
              >
                {column}
                {column === ranked && (
                  <span aria-hidden="true" className="text-xs text-accent">
                    ▼
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
        <div
          ref={scrollRef}
          role="rowgroup"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          className="relative min-h-0 flex-1 overflow-auto"
        >
          {message !== null ? (
            <div role="row">
              <p role="gridcell" className="px-4 py-3 text-ink-muted">
                {message}
              </p>
            </div>
          ) : (
            <div className="relative" style={{ height: rows.length * TREE_ROW_HEIGHT }}>
              {lines}
            </div>
          )}
        </div>
      </div>
    </PaneShell>
  )
}
