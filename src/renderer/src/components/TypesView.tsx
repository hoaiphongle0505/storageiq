import { useEffect, useState } from 'react'
import type { IconImage } from '@shared/ipc-contract'
import { typesCsv } from '../lib/csv'
import { formatCount, formatSize, percentOf } from '../lib/format'
import { IconRowFile } from '../lib/icons'
import {
  totalSize,
  typeCategoryLabel,
  typeIconKey,
  typeIconKeys,
  typeLabel,
} from '../lib/side-view-model'
import { useSideView } from '../lib/use-side-view'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'
import { CopyCsvButton } from './CopyCsvButton'
import { LARGE_ICON_MIN_DPR } from './FileIcon'
import { PaneShell } from './PaneShell'
import {
  PaneMessage,
  ScanningNote,
  ShareBar,
  SIDE_ROW_CLASS,
  SideViewError,
  SideViewTable,
} from './SideViewParts'
import { CategorySwatch } from './TreemapLegend'

export const NO_TYPES_TEXT = 'There are no files in this folder.'

const COLUMNS = [
  { label: 'Extension' },
  { label: 'Category' },
  { label: 'Size', numeric: true },
  { label: 'Allocated', numeric: true },
  { label: 'Files', numeric: true },
  { label: '% of folder' },
]

/** A type's Windows icon (16 CSS px, like the tree's), or the file placeholder until it arrives. */
function TypeIcon({ image }: { image: IconImage | undefined }) {
  if (image === undefined) {
    return (
      <IconRowFile
        aria-hidden="true"
        focusable={false}
        className="size-4 shrink-0 text-ink-muted"
      />
    )
  }
  const large = window.devicePixelRatio >= LARGE_ICON_MIN_DPR
  return (
    <img
      src={large ? image.large : image.small}
      width={16}
      height={16}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="size-4 shrink-0 object-contain"
    />
  )
}

/**
 * The space each file extension uses below the treemap folder: Windows' icon and the extension,
 * the file type with its treemap colour, Size, Allocated, Files and a "% of folder" bar. Sorted by
 * Size; the scanner folds extensions beyond the 500 biggest into "Other extensions".
 */
export function TypesView({ height }: { height: number }) {
  const unit = useWorkspace((s) => s.unit)
  const fetchTypes = useWorkspace((s) => s.fetchTypes)
  const loadTypeIcons = useWorkspace((s) => s.loadTypeIcons)
  const state = useSideView(fetchTypes)
  const rows = state.status === 'ready' ? state.rows : null
  const [icons, setIcons] = useState<Record<string, IconImage>>({})

  useEffect(() => {
    if (rows === null) return
    let current = true
    void loadTypeIcons(typeIconKeys(rows)).then((found) => {
      if (current) setIcons((known) => ({ ...known, ...found }))
    })
    return () => {
      current = false
    }
  }, [rows, loadTypeIcons])

  const total = rows === null ? 0 : totalSize(rows)

  return (
    <PaneShell
      height={height}
      label="Types"
      actions={
        <CopyCsvButton build={() => typesCsv(rows ?? [])} rows={rows === null ? 0 : rows.length} />
      }
    >
      <ScanningNote />
      {state.status === 'gone' && <PaneMessage>{GONE_MESSAGE}</PaneMessage>}
      {state.status === 'error' && <SideViewError onRetry={state.retry} />}
      {rows !== null && rows.length === 0 && <PaneMessage>{NO_TYPES_TEXT}</PaneMessage>}
      {rows !== null && rows.length > 0 && (
        <SideViewTable label="File types in this folder" columns={COLUMNS}>
          {rows.map((row) => {
            const key = typeIconKey(row)
            return (
              <tr key={`${row.kind}:${row.ext}`} className="hover:bg-row-hover">
                <td className={`${SIDE_ROW_CLASS} px-3`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <TypeIcon image={key === null ? undefined : icons[key]} />
                    <span className="truncate">{typeLabel(row)}</span>
                  </span>
                </td>
                <td className="px-3">
                  <span className="flex items-center gap-1.5">
                    {row.category !== null && <CategorySwatch category={row.category} />}
                    {typeCategoryLabel(row)}
                  </span>
                </td>
                <td className="px-3 text-right" title={`${formatCount(row.size)} bytes`}>
                  {formatSize(row.size, unit)}
                </td>
                <td className="px-3 text-right" title={`${formatCount(row.allocated)} bytes`}>
                  {formatSize(row.allocated, unit)}
                </td>
                <td className="px-3 text-right">{formatCount(row.files)}</td>
                <td className="px-3">
                  <ShareBar share={percentOf(row.size, total)} />
                </td>
              </tr>
            )
          })}
        </SideViewTable>
      )}
    </PaneShell>
  )
}
