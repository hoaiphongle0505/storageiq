import type { TreeRow } from '@shared/tree-types'
import { useIconCache, useRowIcon } from '../lib/icon-cache-context'
import { IconRowDrive, IconRowFile, IconRowFiles, IconRowFolder } from '../lib/icons'

/** At this device pixel ratio or above the large bitmap is used (the browser scales it down). */
export const LARGE_ICON_MIN_DPR = 1.25

const isDriveName = (name: string): boolean => /^[A-Za-z]:\\?$/.test(name)

/**
 * The icon of a tree row, in a fixed 16 x 16 CSS px box that exists before and after loading (no
 * layout shift). A Fluent placeholder fills it until Windows' own icon for that file type, folder
 * or drive arrives; then an `<img>` replaces the placeholder. Windows' bitmaps follow the system
 * metrics (24 px at 150 %), so the image is always drawn at 16 CSS px: the small one below a
 * device pixel ratio of 1.25, the large one (scaled down, sharp) from there. The icon is
 * decoration: the row's accessible name is its file name. "[N files]" rows only ever show the
 * placeholder.
 */
export function FileIcon({ row, root }: { row: TreeRow; root: boolean }) {
  const cache = useIconCache()
  const image = useRowIcon(row.kind === 'files' ? '' : row.id)
  const className = 'size-4 shrink-0 text-ink-muted'
  let content
  if (image !== undefined && row.kind !== 'files') {
    const large = window.devicePixelRatio >= LARGE_ICON_MIN_DPR
    content = (
      <img
        src={large ? image.large : image.small}
        width={16}
        height={16}
        alt=""
        aria-hidden="true"
        draggable={false}
        decoding="async"
        data-icon={cache?.keyOf(row.id) ?? ''}
        className="size-4 shrink-0 object-contain"
      />
    )
  } else if (row.kind === 'files') {
    content = <IconRowFiles aria-hidden="true" focusable={false} className={className} />
  } else if (row.kind === 'file') {
    content = <IconRowFile aria-hidden="true" focusable={false} className={className} />
  } else if (root && isDriveName(row.name)) {
    content = <IconRowDrive aria-hidden="true" focusable={false} className={className} />
  } else {
    content = <IconRowFolder aria-hidden="true" focusable={false} className="size-4 shrink-0" />
  }
  return (
    <span
      aria-hidden="true"
      data-file-icon
      className="flex size-4 shrink-0 items-center justify-center"
    >
      {content}
    </span>
  )
}
