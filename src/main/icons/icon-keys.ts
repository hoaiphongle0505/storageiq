import { createHash } from 'node:crypto'
import type { NodeKind } from '@shared/tree-types'
import { ICON_TYPE_KEY_PATTERN } from '../ipc/parse-args'

/**
 * What the icon worker looks up. `dir` and `file` targets are looked up by attributes only (no
 * disk access); a `path` target is a scanner path (a per-file icon, a drive root or a known
 * folder), never a path the renderer sent.
 */
export type NativeTarget =
  { kind: 'dir' } | { kind: 'file'; ext: string } | { kind: 'path'; path: string }

/**
 * Files of these types carry their own icon (an `.exe` has an icon resource, a `.lnk` shows its
 * target's icon with the arrow), so each one is looked up by its real path. Every other
 * extension shares one icon per type. `.dll`, `.bat` and `.cmd` are deliberately absent: Explorer
 * shows one icon per type for them.
 */
export const PER_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.exe',
  '.lnk',
  '.ico',
  '.url',
  '.scr',
  '.cpl',
  '.msi',
])

const EXTENSION_PATTERN = /^[a-z0-9_$~-]{1,16}$/

/** The extension of `name` without the dot, lower case, or '' when there is none or it is unsafe. */
export function safeExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  const ext = name.slice(dot + 1).toLowerCase()
  return EXTENSION_PATTERN.test(ext) ? ext : ''
}

/**
 * The shared icon key of a row: `drive`, `dir`, `ext:<extension>` or `file` (no usable
 * extension). It never carries a path.
 */
export function typeKeyOf(row: { kind: NodeKind; name: string }, isDriveRoot: boolean): string {
  if (row.kind === 'folder') return isDriveRoot ? 'drive' : 'dir'
  if (row.kind === 'files') return 'file'
  const ext = safeExtension(row.name)
  return ext === '' ? 'file' : `ext:${ext}`
}

/** Whether files of this type key get their own per-file icon. */
export function isPerFileExtension(typeKey: string): boolean {
  return typeKey.startsWith('ext:') && PER_FILE_EXTENSIONS.has(`.${typeKey.slice(4)}`)
}

/** First 12 hex digits of sha1 of the lower-cased path: stable, case-insensitive, leaks no path. */
function pathKey(path: string): string {
  return `f:${createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 12)}`
}

/**
 * The cache key of an icon. Type icons keep their type key; a per-file extension, with its path,
 * gets `f:<hash>`; a drive root gets `drive:<letter>` (fixed, USB and network drives differ).
 */
export function iconKeyFor(typeKey: string, path: string | null): string {
  if (path === null) return typeKey
  if (typeKey === 'drive') {
    const letter = /^([A-Za-z]):/.exec(path)?.[1]
    return letter === undefined ? 'drive' : `drive:${letter.toLowerCase()}`
  }
  return isPerFileExtension(typeKey) ? pathKey(path) : typeKey
}

/** A folder path as compared with the known folders: lower case, no trailing backslash. */
export function normalizeFolderPath(path: string): string {
  return path.toLowerCase().replace(/[\\/]+$/, '')
}

/**
 * The icon key of a folder row. A folder whose path is one of the known folders (Desktop,
 * Documents, Downloads, Pictures, Music, Videos, the user profile) shows Explorer's own icon for
 * it, so it gets a per-path key; every other folder shares the generic `dir` key.
 */
export function folderKeyFor(path: string, known: ReadonlySet<string>): string {
  const normalized = normalizeFolderPath(path)
  return known.has(normalized) ? pathKey(normalized) : 'dir'
}

/** The lookup a type key (the renderer's `icons:for-types`) stands for; throws for anything else. */
export function parseTypeKey(key: string): NativeTarget {
  if (!ICON_TYPE_KEY_PATTERN.test(key)) throw new Error('Not an icon type key.')
  if (key === 'dir') return { kind: 'dir' }
  if (key === 'file') return { kind: 'file', ext: '' }
  if (key === 'drive') return { kind: 'path', path: `${process.env['SystemDrive'] ?? 'C:'}\\` }
  return { kind: 'file', ext: key.slice(4) }
}
