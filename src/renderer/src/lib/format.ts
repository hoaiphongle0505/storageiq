import { modeValue, type SizeMode, type TreeRow } from '@shared/tree-types'

const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const
const countFormat = new Intl.NumberFormat('en-US')
const oneDecimal = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})
const dateFormat = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
})

/** The Unit toggle: Auto picks KB to PB per value; the others force one unit. */
export type SizeUnit = 'auto' | 'gb' | 'mb' | 'kb'
export const SIZE_UNITS: readonly SizeUnit[] = ['auto', 'gb', 'mb', 'kb']

export function formatCount(value: number): string {
  return countFormat.format(value)
}

/** Windows-style sizes: 1024-based, `bytes` below 1 KB, one decimal below 100. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes === 1 ? '1 byte' : `${formatCount(bytes)} bytes`
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 100 ? 1 : 0)} ${UNITS[unit] ?? 'PB'}`
}

const FORCED: Record<Exclude<SizeUnit, 'auto'>, { divisor: number; label: string }> = {
  gb: { divisor: 1024 ** 3, label: 'GB' },
  mb: { divisor: 1024 ** 2, label: 'MB' },
  kb: { divisor: 1024, label: 'KB' },
}

/** A size in the chosen unit, for example `12.3 GB` or `0.4 MB` (one decimal when forced). */
export function formatSize(bytes: number, unit: SizeUnit): string {
  if (unit === 'auto') return formatBytes(bytes)
  const { divisor, label } = FORCED[unit]
  return `${oneDecimal.format(bytes / divisor)} ${label}`
}

/** Share of the parent with one decimal: `59.9%`; tiny non-zero shares show `<0.1%`. */
export function formatShare(fraction: number): string {
  if (fraction > 0 && fraction < 0.0005) return '<0.1%'
  return `${oneDecimal.format(fraction * 100)}%`
}

export function formatDate(ms: number): string {
  return ms > 0 ? dateFormat.format(new Date(ms)) : ''
}

export function formatDuration(ms: number): string {
  if (ms < 100) return 'under 0.1 s'
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds} s`
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes < 60) return `${minutes} min ${String(totalSeconds % 60).padStart(2, '0')} s`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

export function percentOf(part: number, total: number): number {
  return total > 0 ? part / total : 0
}

/** Shortens long paths in the middle so both the drive and the file name stay visible. */
export function middleTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const keep = maxLength - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

/** The value shown before a row's name: a size, a file count, or the share of the parent. */
export function formatModeValue(
  row: Pick<TreeRow, 'size' | 'allocated' | 'files'>,
  mode: SizeMode,
  unit: SizeUnit,
  share: number,
): string {
  switch (mode) {
    case 'size':
      return formatSize(row.size, unit)
    case 'allocated':
      return formatSize(row.allocated, unit)
    case 'files':
      return formatCount(row.files)
    case 'percent':
      return formatShare(share)
  }
}

/** The row's share of its parent in the given Mode (the root is 100%). */
export function shareOfParent(
  row: Pick<TreeRow, 'size' | 'allocated' | 'files'>,
  parent: Pick<TreeRow, 'size' | 'allocated' | 'files'> | null,
  mode: SizeMode,
): number {
  if (parent === null) return 1
  return percentOf(modeValue(row, mode), modeValue(parent, mode))
}

/** `[3 files]` / `[1 file]`: the row that groups the files directly in a folder. */
export function filesRowName(files: number): string {
  return files === 1 ? '[1 file]' : `[${formatCount(files)} files]`
}

/** The text shown for a row's name. */
export function rowName(row: Pick<TreeRow, 'kind' | 'name' | 'files'>): string {
  return row.kind === 'files' ? filesRowName(row.files) : row.name
}
