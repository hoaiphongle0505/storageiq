import type { AgeRow, TopFileRow, TypeRow } from '@shared/tree-types'
import { typeCategoryLabel, typeLabel } from './side-view-model'

/** One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. */
export function csvField(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** A header row and the rows, comma separated, one per line (CRLF), with a final line break. */
export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number>>,
): string {
  return [header, ...rows].map((fields) => fields.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** ISO 8601 in UTC (`2026-11-19T12:00:00.000Z`); `''` when the date is unknown. */
export function isoDate(ms: number): string {
  return ms > 0 ? new Date(ms).toISOString() : ''
}

/**
 * The CSV of each list view. Sizes are raw byte counts and dates are ISO 8601, so a spreadsheet
 * can sort and add them. Values are copied as they are: a file name that starts with `=`, `+`,
 * `-` or `@` is not changed, so a spreadsheet may read it as a formula.
 */
export function topFilesCsv(rows: readonly TopFileRow[]): string {
  return toCsv(
    ['Name', 'Folder', 'Size (bytes)', 'Allocated (bytes)', 'Modified (UTC)'],
    rows.map((row) => [row.name, row.folder, row.size, row.allocated, isoDate(row.modifiedMs)]),
  )
}

export function typesCsv(rows: readonly TypeRow[]): string {
  return toCsv(
    ['Extension', 'Category', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
    rows.map((row) => [typeLabel(row), typeCategoryLabel(row), row.size, row.allocated, row.files]),
  )
}

export function ageCsv(rows: readonly AgeRow[]): string {
  return toCsv(
    ['Age', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
    rows.map((row) => [row.label, row.size, row.allocated, row.files]),
  )
}
