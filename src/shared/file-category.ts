import { type CategoryShare, FILE_CATEGORIES, type FileCategory } from './tree-types'

export const CATEGORY_COUNT = FILE_CATEGORIES.length

export const CATEGORY_LABELS: Record<FileCategory, string> = {
  video: 'Video',
  image: 'Images',
  audio: 'Audio',
  document: 'Documents',
  archive: 'Archives',
  code: 'Code',
  app: 'Apps & installers',
  system: 'System & libraries',
  'disk-image': 'Disk images',
  other: 'Other',
}

/**
 * Extensions per file type. `ts` is Code (TypeScript), not video: the design spec lists it twice and
 * requires each extension once.
 *
 * Lower case, no dot. Everything else is `other`.
 */
export const CATEGORY_EXTENSIONS: Record<Exclude<FileCategory, 'other'>, readonly string[]> = {
  video: 'mp4 m4v mkv mov avi wmv webm flv f4v mpg mpeg m2ts mts vob 3gp ogv'.split(' '),
  image:
    'jpg jpeg jfif png gif bmp tif tiff webp heic heif avif svg ico psd raw cr2 cr3 nef arw dng orf rw2 raf'.split(
      ' ',
    ),
  audio: 'mp3 wav flac aac m4a ogg oga opus wma aif aiff alac mid midi'.split(' '),
  document:
    'pdf doc docx docm xls xlsx xlsm xlsb ppt pptx odt ods odp rtf txt md csv tsv epub mobi one msg eml pst ost'.split(
      ' ',
    ),
  archive: 'zip 7z rar tar gz tgz bz2 tbz2 xz txz zst lz lzma cab'.split(' '),
  code: 'js mjs cjs ts tsx jsx json py pyc ipynb java class jar c h cpp cc hpp cs go rs rb php html htm css scss less sql sh ps1 psm1 bat cmd yml yaml toml xml map lock o obj pdb wasm'.split(
    ' ',
  ),
  app: 'exe msi msp msix msixbundle appx appxbundle apk xapk appimage com scr'.split(' '),
  system:
    'dll sys drv ocx mui cpl efi inf cat manifest lib a so dylib node etl evtx dmp mdmp log tmp temp pf'.split(
      ' ',
    ),
  'disk-image': 'iso img vhd vhdx vmdk vdi qcow2 wim esd dmg ova'.split(' '),
}

const OTHER_INDEX = FILE_CATEGORIES.indexOf('other')

const INDEX_BY_EXTENSION = new Map<string, number>()
for (const [category, extensions] of Object.entries(CATEGORY_EXTENSIONS)) {
  const index = FILE_CATEGORIES.indexOf(category as FileCategory)
  for (const extension of extensions) INDEX_BY_EXTENSION.set(extension, index)
}

/** Text after the last dot, lower case; `''` for no dot, a leading-dot-only name or a trailing dot. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

/** Index into `FILE_CATEGORIES` for a file name. */
export function fileCategoryIndex(name: string): number {
  return INDEX_BY_EXTENSION.get(fileExtension(name)) ?? OTHER_INDEX
}

export function fileCategory(name: string): FileCategory {
  return FILE_CATEGORIES[fileCategoryIndex(name)] ?? 'other'
}

/** The category holding at least half of the bytes (ties: lower index), else `null`. */
export function dominantCategory(bytes: ArrayLike<number>): FileCategory | null {
  let sum = 0
  let best = -1
  let bestBytes = 0
  for (let i = 0; i < CATEGORY_COUNT; i += 1) {
    const value = bytes[i] ?? 0
    sum += value
    if (value > bestBytes) {
      bestBytes = value
      best = i
    }
  }
  if (sum <= 0 || best < 0 || bestBytes * 2 < sum) return null
  return FILE_CATEGORIES[best] ?? null
}

/** Non-empty categories, largest first; ties keep `FILE_CATEGORIES` order. */
export function categoryShares(bytes: ArrayLike<number>): CategoryShare[] {
  const shares: CategoryShare[] = []
  FILE_CATEGORIES.forEach((category, index) => {
    const value = bytes[index] ?? 0
    if (value > 0) shares.push({ category, bytes: value })
  })
  return shares.sort((a, b) => b.bytes - a.bytes)
}
