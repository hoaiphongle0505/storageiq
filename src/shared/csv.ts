/** One spreadsheet cell: text, a number, a date (UTC), or empty. */
export type Cell = string | number | Date | null

/** UTF-8 byte order mark: Excel needs it to open a UTF-8 CSV with the right characters. */
export const CSV_BOM = '﻿'

/** Text that starts with one of these is read by a spreadsheet as a formula (OWASP). */
const FORMULA_START = /^[=+\-@\t\r]/

/**
 * One CSV field (RFC 4180): quoted when it holds a comma, a quote or a line break. A text cell that
 * could be read as a formula gets a leading `'`; numbers are never changed. Dates are ISO 8601 in
 * UTC (`2026-11-19T12:00:00.000Z`), and an empty cell is empty.
 */
export function csvField(value: Cell): string {
  if (value === null) return ''
  if (value instanceof Date) return value.toISOString()
  const text = typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** One CSV line, CRLF-terminated. */
export function csvLine(fields: readonly Cell[]): string {
  return fields.map(csvField).join(',') + '\r\n'
}

/** A header row and the rows, comma separated, one per line (CRLF), with a final line break. */
export function toCsv(header: readonly string[], rows: ReadonlyArray<readonly Cell[]>): string {
  return [header, ...rows].map(csvLine).join('')
}
