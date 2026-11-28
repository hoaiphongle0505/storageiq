import { ageCsv } from '../lib/csv'
import { formatCount, formatSize, percentOf } from '../lib/format'
import { totalSize } from '../lib/side-view-model'
import { useSideView } from '../lib/use-side-view'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'
import { CopyCsvButton } from './CopyCsvButton'
import { PaneShell } from './PaneShell'
import { PaneMessage, ScanningNote, ShareBar, SIDE_ROW_CLASS, SideViewTable } from './SideViewParts'

const COLUMNS = [
  { label: 'Age' },
  { label: 'Size', numeric: true },
  { label: 'Allocated', numeric: true },
  { label: 'Files', numeric: true },
  { label: '% of folder' },
]

/**
 * The space used by files of each modification age below the treemap folder. The scanner always
 * returns all 8 buckets, in order, so empty ones show too; "Unknown date" also holds files dated
 * in the future.
 */
export function AgeView({ height }: { height: number }) {
  const unit = useWorkspace((s) => s.unit)
  const fetchAges = useWorkspace((s) => s.fetchAges)
  const state = useSideView(fetchAges)
  const rows = state.status === 'ready' ? state.rows : null
  const total = rows === null ? 0 : totalSize(rows)

  return (
    <PaneShell
      height={height}
      label="Age"
      actions={
        <CopyCsvButton build={() => ageCsv(rows ?? [])} rows={rows === null ? 0 : rows.length} />
      }
    >
      <ScanningNote />
      {state.status === 'gone' && <PaneMessage>{GONE_MESSAGE}</PaneMessage>}
      {rows !== null && (
        <SideViewTable label="File age in this folder" columns={COLUMNS}>
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-row-hover">
              <th scope="row" className={`${SIDE_ROW_CLASS} px-3 text-left font-normal`}>
                {row.label}
              </th>
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
          ))}
        </SideViewTable>
      )}
    </PaneShell>
  )
}
