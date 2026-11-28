import { CATEGORY_LABELS } from '@shared/file-category'
import type { TypeRow } from '@shared/tree-types'

export const NO_EXTENSION_LABEL = '(no extension)'
export const OTHER_EXTENSIONS_LABEL = 'Other extensions'

/** Most icon keys one `icons:for-types` call takes (the same limit as main). */
export const MAX_TYPE_ICON_KEYS = 64
/** The extension part of an icon key that main accepts (main's `ICON_TYPE_KEY_PATTERN`). */
const ICON_EXTENSION = /^[a-z0-9_$~-]{1,16}$/

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

/** The icon key of a Types row (`ext:jpg`, `file`), or null when it has no icon to ask for. */
export function typeIconKey(row: Pick<TypeRow, 'kind' | 'ext'>): string | null {
  if (row.kind === 'none') return 'file'
  if (row.kind === 'extension' && ICON_EXTENSION.test(row.ext)) return `ext:${row.ext}`
  return null
}

/** The icon keys to ask for: the first rows that have one, each once, at most 64. */
export function typeIconKeys(rows: ReadonlyArray<Pick<TypeRow, 'kind' | 'ext'>>): string[] {
  const keys = new Set<string>()
  for (const row of rows) {
    const key = typeIconKey(row)
    if (key !== null) keys.add(key)
    if (keys.size >= MAX_TYPE_ICON_KEYS) break
  }
  return [...keys]
}

/** The sum of the `size` of every row (the "% of folder" bars are shares of it). */
export function totalSize(rows: ReadonlyArray<{ size: number }>): number {
  return rows.reduce((sum, row) => sum + row.size, 0)
}
