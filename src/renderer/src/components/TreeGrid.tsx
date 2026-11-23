import { ChevronRight, File, Files, Folder, HardDrive } from 'lucide-react'
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ROOT_NODE_ID, type NodeId, type SizeMode, type TreeRow } from '@shared/tree-types'
import {
  formatCount,
  formatDate,
  formatModeValue,
  formatShare,
  formatSize,
  rowName,
  shareOfParent,
  type SizeUnit,
} from '../lib/format'
import { buildVisibleModel, chunksFor, type VisibleRow } from '../lib/tree-view-model'
import { type ColumnId, effectiveSort } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'

/** Must equal `--size-tree-row` in design/tokens.json. */
export const TREE_ROW_HEIGHT = 30
const OVERSCAN = 10
/** Rows taking this share of their parent or more are bold. */
export const BOLD_SHARE = 0.1
const INDENT = 16

export const COLUMNS: ReadonlyArray<{ id: ColumnId; label: string; numeric: boolean }> = [
  { id: 'name', label: 'Name', numeric: false },
  { id: 'size', label: 'Size', numeric: true },
  { id: 'allocated', label: 'Allocated', numeric: true },
  { id: 'files', label: 'Files', numeric: true },
  { id: 'folders', label: 'Folders', numeric: true },
  { id: 'percent', label: '% of Parent', numeric: true },
  { id: 'modified', label: 'Last Modified', numeric: false },
]

const GRID_TEMPLATE =
  'minmax(var(--size-col-name-min),1fr) var(--size-col-size) var(--size-col-allocated) var(--size-col-files) var(--size-col-folders) var(--size-col-percent) var(--size-col-modified)'

export const EMPTY_TREE_TEXT = 'Choose a drive or folder from Select to see what’s using the space.'

export function rowDomId(id: NodeId): string {
  return `tree-row-${id}`
}

function RowIcon({ row, root }: { row: TreeRow; root: boolean }) {
  const className = 'size-4 shrink-0 text-ink-muted'
  if (root) return <HardDrive aria-hidden="true" className={className} />
  if (row.kind === 'files') return <Files aria-hidden="true" className={className} />
  if (row.kind === 'file') return <File aria-hidden="true" className={className} />
  return <Folder aria-hidden="true" className={className} />
}

interface RowProps {
  line: VisibleRow
  row: TreeRow
  rowIndex: number
  parent: TreeRow | null
  expanded: boolean
  selected: boolean
  mode: SizeMode
  unit: SizeUnit
  onSelect(id: NodeId): void
  onToggle(id: NodeId, open: boolean): void
  onContextMenu(id: NodeId, event: MouseEvent): void
}

function GridRow({
  line,
  row,
  rowIndex,
  parent,
  expanded,
  selected,
  mode,
  unit,
  onSelect,
  onToggle,
  onContextMenu,
}: RowProps) {
  const share = shareOfParent(row, parent, mode)
  const bold = share >= BOLD_SHARE
  const hasChildren = row.childCount > 0
  return (
    <div
      id={rowDomId(row.id)}
      role="row"
      aria-rowindex={rowIndex + 2}
      aria-level={line.depth + 1}
      aria-setsize={line.setSize}
      aria-posinset={line.index + 1}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-selected={selected}
      onClick={() => onSelect(row.id)}
      onDoubleClick={() => hasChildren && onToggle(row.id, !expanded)}
      onContextMenu={(event) => onContextMenu(row.id, event)}
      className={`absolute inset-x-0 grid cursor-default items-center border-b border-line/60 tabular-nums select-none ${
        selected ? 'bg-selection' : 'hover:bg-row-hover'
      } ${bold ? 'font-semibold' : ''}`}
      style={{
        gridTemplateColumns: GRID_TEMPLATE,
        height: TREE_ROW_HEIGHT,
        transform: `translateY(${rowIndex * TREE_ROW_HEIGHT}px)`,
      }}
    >
      <div
        role="gridcell"
        className="flex min-w-0 items-center gap-1 pr-2"
        style={{ paddingLeft: line.depth * INDENT + 4 }}
      >
        <span
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation()
            if (hasChildren) onToggle(row.id, !expanded)
          }}
          className="flex size-5 shrink-0 items-center justify-center"
        >
          {hasChildren && (
            <ChevronRight
              className={`size-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          )}
        </span>
        <RowIcon row={row} root={line.parentId === null} />
        <span className="relative flex min-w-0 flex-1 items-center gap-2 px-1">
          <span
            aria-hidden="true"
            data-testid="name-bar"
            className="absolute inset-y-1 left-0 rounded-sm bg-bar"
            style={{ width: `${Math.min(1, share) * 100}%` }}
          />
          <span className="relative shrink-0">{formatModeValue(row, mode, unit, share)}</span>
          <span className="relative min-w-0 truncate" title={rowName(row)}>
            {rowName(row)}
          </span>
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
      <div role="gridcell" className="pr-3 text-right">
        {formatCount(row.files)}
      </div>
      <div role="gridcell" className="pr-3 text-right">
        {formatCount(row.folders)}
      </div>
      <div role="gridcell" className="flex items-center gap-2 pr-3">
        <span aria-hidden="true" className="h-2 w-10 shrink-0 overflow-hidden rounded-full bg-bar">
          <span
            className="block h-full bg-bar-fill"
            style={{ width: `${Math.min(1, share) * 100}%` }}
          />
        </span>
        <span className="flex-1 text-right">{formatShare(share)}</span>
      </div>
      <div role="gridcell" className="truncate pr-2">
        {formatDate(row.modifiedMs)}
      </div>
    </div>
  )
}

/**
 * The column tree: an ARIA treegrid, virtualized by hand (only the lines in view, plus a few
 * above and below, are in the DOM; the scanner pages the rows in), sortable by every column.
 * Keyboard: ↑ ↓ Home End PageUp PageDown move, → expands or enters, ← collapses or goes up,
 * Enter opens in Explorer, Shift+F10 or the Menu key opens the Explorer context menu,
 * Ctrl+C copies the path and Ctrl+N creates a folder.
 */
export function TreeGrid() {
  const phase = useWorkspace((s) => s.phase)
  const scanId = useWorkspace((s) => s.scanId)
  const lists = useWorkspace((s) => s.lists)
  const expanded = useWorkspace((s) => s.expanded)
  const selectedId = useWorkspace((s) => s.selectedId)
  const scrollTarget = useWorkspace((s) => s.scrollTarget)
  const revision = useWorkspace((s) => s.revision)
  const mode = useWorkspace((s) => s.mode)
  const unit = useWorkspace((s) => s.unit)
  const sortColumn = useWorkspace((s) => s.sortColumn)
  const sortDir = useWorkspace((s) => s.sortDir)
  const requestChunks = useWorkspace((s) => s.requestChunks)
  const setExpanded = useWorkspace((s) => s.setExpanded)
  const select = useWorkspace((s) => s.select)
  const sortBy = useWorkspace((s) => s.sortBy)
  const openInExplorer = useWorkspace((s) => s.openInExplorer)
  const showContextMenu = useWorkspace((s) => s.showContextMenu)
  const createFolder = useWorkspace((s) => s.createFolder)
  const copyPath = useWorkspace((s) => s.copyPath)

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)
  const handledScroll = useRef(0)

  const model = useMemo(() => buildVisibleModel(lists, expanded, ROOT_NODE_ID), [lists, expanded])
  const first = Math.max(0, Math.floor(scrollTop / TREE_ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(
    model.count - 1,
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

  // Load the chunks for the lines in view (and refresh stale ones after each scanner update).
  useEffect(() => {
    if (scanId === null) return
    requestChunks([{ nodeId: ROOT_NODE_ID, chunk: 0 }, ...chunksFor(model, first, last)])
  }, [scanId, model, first, last, revision, requestChunks])

  const ensureVisible = (index: number) => {
    const element = scrollRef.current
    if (element === null || index < 0) return
    const top = index * TREE_ROW_HEIGHT
    const height = element.clientHeight || viewport
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + TREE_ROW_HEIGHT > element.scrollTop + height) {
      element.scrollTop = top + TREE_ROW_HEIGHT - height
    }
    setScrollTop(element.scrollTop)
  }

  useLayoutEffect(() => {
    if (scrollTarget === null || scrollTarget.seq === handledScroll.current) return
    const index = model.indexOf(scrollTarget.id)
    if (index === -1) return
    handledScroll.current = scrollTarget.seq
    ensureVisible(index)
    // ensureVisible only reads refs and setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget, model])

  const selectedIndex = selectedId === null ? -1 : model.indexOf(selectedId)
  const selectedLine = selectedIndex === -1 ? null : model.rowAt(selectedIndex)

  const moveTo = (index: number) => {
    const clamped = Math.max(0, Math.min(model.count - 1, index))
    const line = model.rowAt(clamped)
    if (line?.row) {
      select(line.row.id)
      ensureVisible(clamped)
    }
  }

  const openMenuForSelected = (extended: boolean) => {
    if (selectedId === null) return
    const element = document.getElementById(rowDomId(selectedId))
    const rect = element?.getBoundingClientRect()
    void showContextMenu(selectedId, (rect?.left ?? 0) + 32, rect?.bottom ?? 0, extended)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (model.count === 0) return
    const row = selectedLine?.row ?? null
    const pageRows = Math.max(1, Math.floor(viewport / TREE_ROW_HEIGHT) - 1)
    const isExpanded = row !== null && expanded.has(row.id)
    let handled = true
    if (event.key === 'ArrowDown') moveTo(selectedIndex + 1)
    else if (event.key === 'ArrowUp') moveTo(selectedIndex === -1 ? 0 : selectedIndex - 1)
    else if (event.key === 'Home') moveTo(0)
    else if (event.key === 'End') moveTo(model.count - 1)
    else if (event.key === 'PageDown') moveTo(selectedIndex + pageRows)
    else if (event.key === 'PageUp') moveTo(selectedIndex - pageRows)
    else if (event.key === 'ArrowRight' && row !== null) {
      if (row.childCount > 0 && !isExpanded) setExpanded(row.id, true)
      else if (isExpanded) moveTo(selectedIndex + 1)
    } else if (event.key === 'ArrowLeft' && row !== null) {
      if (isExpanded) setExpanded(row.id, false)
      else if (selectedLine?.parentId) {
        const parentIndex = model.indexOf(selectedLine.parentId)
        if (parentIndex !== -1) moveTo(parentIndex)
      }
    } else if (event.key === 'Enter' && row !== null) void openInExplorer(row.id)
    else if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      openMenuForSelected(false)
    } else if (event.ctrlKey && event.key.toLowerCase() === 'n' && row !== null) {
      void createFolder(row.id)
    } else if (event.ctrlKey && event.key.toLowerCase() === 'c' && row !== null) {
      void copyPath(row.id)
    } else handled = false
    if (handled) event.preventDefault()
  }

  const onRowContextMenu = (id: NodeId, event: MouseEvent) => {
    event.preventDefault()
    select(id)
    void showContextMenu(id, event.clientX, event.clientY, event.shiftKey)
  }

  const sort = effectiveSort({ sortColumn, sortDir, mode })
  const sortedColumn: ColumnId = sortColumn ?? 'percent'
  const lines: ReactNode[] = []
  for (let i = first; i <= last; i += 1) {
    const line = model.rowAt(i)
    if (line === null) continue
    if (line.row === null) {
      lines.push(
        <div
          key={`loading-${line.parentId}-${line.index}`}
          role="row"
          aria-rowindex={i + 2}
          aria-level={line.depth + 1}
          className="absolute inset-x-0 flex items-center text-ink-muted"
          style={{
            height: TREE_ROW_HEIGHT,
            transform: `translateY(${i * TREE_ROW_HEIGHT}px)`,
            paddingLeft: line.depth * INDENT + 32,
          }}
        >
          <div role="gridcell">Loading…</div>
        </div>,
      )
      continue
    }
    const parent = line.parentId === null ? null : (lists[line.parentId]?.parent ?? null)
    lines.push(
      <GridRow
        key={line.row.id}
        line={line}
        row={line.row}
        rowIndex={i}
        parent={parent}
        expanded={expanded.has(line.row.id)}
        selected={line.row.id === selectedId}
        mode={mode}
        unit={unit}
        onSelect={select}
        onToggle={setExpanded}
        onContextMenu={onRowContextMenu}
      />,
    )
  }

  const activeRendered = selectedId !== null && selectedIndex >= first && selectedIndex <= last

  return (
    <div
      role="treegrid"
      aria-label="Folder tree"
      aria-rowcount={model.count + 1}
      aria-colcount={COLUMNS.length}
      aria-multiselectable="false"
      aria-activedescendant={
        activeRendered && selectedId !== null ? rowDomId(selectedId) : undefined
      }
      tabIndex={0}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      className="flex min-h-0 flex-1 flex-col bg-panel focus-visible:outline-offset-[-2px]"
    >
      <div role="rowgroup" className="border-b border-line bg-sunken">
        <div
          role="row"
          aria-rowindex={1}
          className="grid h-(--size-header-row) items-stretch text-sm"
          style={{ gridTemplateColumns: GRID_TEMPLATE }}
        >
          {COLUMNS.map((column) => {
            const active =
              column.id === sortedColumn || (column.id === 'percent' && sortColumn === null)
            const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
            return (
              <div
                key={column.id}
                role="columnheader"
                aria-sort={ariaSort}
                className="border-r border-line last:border-r-0"
              >
                <button
                  type="button"
                  onClick={() => sortBy(column.id)}
                  className={`flex size-full items-center gap-1 px-2 hover:bg-row-hover ${column.numeric ? 'justify-end' : ''}`}
                >
                  {column.label}
                  {active && (
                    <span aria-hidden="true" className="text-xs text-ink-muted">
                      {sort.dir === 'asc' ? '▲' : '▼'}
                    </span>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>
      <div
        ref={scrollRef}
        role="rowgroup"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        {phase === 'empty' ? (
          <div role="row">
            <p role="gridcell" className="px-4 py-3 text-ink-muted">
              {EMPTY_TREE_TEXT}
            </p>
          </div>
        ) : (
          <div className="relative" style={{ height: model.count * TREE_ROW_HEIGHT }}>
            {lines}
          </div>
        )}
      </div>
    </div>
  )
}
