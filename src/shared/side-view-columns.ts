import type { Cell } from './csv'
import { CATEGORY_LABELS } from './file-category'
import type { AgeRow, TopFileRow, TypeRow } from './tree-types'

export const NO_EXTENSION_LABEL = '(no extension)'
export const OTHER_EXTENSIONS_LABEL = 'Other extensions'

/** The text of a Types row: `.jpg`, `(no extension)` or `Other extensions`. */
export function typeLabel(row: Pick<TypeRow, 'kind' | 'ext'>): string {
  if (row.kind === 'none') return NO_EXTENSION_LABEL
  if (row.kind === 'other') return OTHER_EXTENSIONS_LABEL
  return `.${row.ext}`
}

/** The file type name of a Types row; `''` for the "Other extensions" row. */
export function typeCategoryLabel(row: Pick<TypeRow, 'category'>): string {
  return row.category === null ? '' : CATEGORY_LABELS[row.category]
}

/** A modification time as a UTC date; empty when unknown (0). */
export const dateCell = (ms: number): Date | null => (ms > 0 ? new Date(ms) : null)

/** The columns of a list view as a table: the Copy as CSV text and the Excel sheets share them. */
export interface ListColumns<T> {
  header: readonly string[]
  cells(row: T): Cell[]
}

/** Sizes are raw byte counts, so a spreadsheet can sort and add them. */
export const TOP_FILES_COLUMNS: ListColumns<TopFileRow> = {
  header: ['Name', 'Folder', 'Size (bytes)', 'Allocated (bytes)', 'Modified (UTC)'],
  cells: (row) => [row.name, row.folder, row.size, row.allocated, dateCell(row.modifiedMs)],
}

export const TYPES_COLUMNS: ListColumns<TypeRow> = {
  header: ['Extension', 'Category', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
  cells: (row) => [typeLabel(row), typeCategoryLabel(row), row.size, row.allocated, row.files],
}

export const AGE_COLUMNS: ListColumns<AgeRow> = {
  header: ['Age', 'Size (bytes)', 'Allocated (bytes)', 'Files'],
  cells: (row) => [row.label, row.size, row.allocated, row.files],
}
