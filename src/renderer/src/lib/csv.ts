import { toCsv } from '@shared/csv'
import { AGE_COLUMNS, TOP_FILES_COLUMNS, TYPES_COLUMNS } from '@shared/side-view-columns'
import type { AgeRow, TopFileRow, TypeRow } from '@shared/tree-types'

export { csvField, toCsv } from '@shared/csv'

/**
 * The CSV of each list view (the columns are shared with the Excel export). Sizes are raw byte
 * counts and dates are ISO 8601 UTC, so a spreadsheet can sort and add them. A text value that a
 * spreadsheet could read as a formula (it starts with `=`, `+`, `-`, `@`, a tab or a CR) gets a
 * leading `'`.
 */
export function topFilesCsv(rows: readonly TopFileRow[]): string {
  return toCsv(
    TOP_FILES_COLUMNS.header,
    rows.map((row) => TOP_FILES_COLUMNS.cells(row)),
  )
}

export function typesCsv(rows: readonly TypeRow[]): string {
  return toCsv(
    TYPES_COLUMNS.header,
    rows.map((row) => TYPES_COLUMNS.cells(row)),
  )
}

export function ageCsv(rows: readonly AgeRow[]): string {
  return toCsv(
    AGE_COLUMNS.header,
    rows.map((row) => AGE_COLUMNS.cells(row)),
  )
}
