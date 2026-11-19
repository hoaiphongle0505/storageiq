const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const
const countFormat = new Intl.NumberFormat('en-US')

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

export function formatDuration(ms: number): string {
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

export function formatPercent(fraction: number): string {
  if (fraction > 0 && fraction < 0.005) return '<1%'
  return `${Math.round(fraction * 100)}%`
}

/** Shortens long paths in the middle so both the drive and the file name stay visible. */
export function middleTruncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const keep = maxLength - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}
