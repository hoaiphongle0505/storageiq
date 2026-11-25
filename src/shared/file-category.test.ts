import { describe, expect, it } from 'vitest'
import {
  CATEGORY_COUNT,
  CATEGORY_EXTENSIONS,
  categoryShares,
  dominantCategory,
  fileCategory,
  fileExtension,
} from './file-category'
import { FILE_CATEGORIES } from './tree-types'

function vector(entries: Record<number, number>): number[] {
  const out = new Array<number>(CATEGORY_COUNT).fill(0)
  for (const [index, value] of Object.entries(entries)) out[Number(index)] = value
  return out
}

describe('file categories', () => {
  it('has the ten categories in a fixed order', () => {
    expect([...FILE_CATEGORIES]).toEqual([
      'video',
      'image',
      'audio',
      'document',
      'archive',
      'code',
      'app',
      'system',
      'disk-image',
      'other',
    ])
    expect(CATEGORY_COUNT).toBe(10)
  })

  it('lists each extension once, in lower case, without a dot', () => {
    const all = Object.values(CATEGORY_EXTENSIONS).flat()
    expect(new Set(all).size).toBe(all.length)
    for (const extension of all) expect(extension).toMatch(/^[a-z0-9]+$/)
  })

  it('reads the extension after the last dot', () => {
    expect(fileExtension('Movie.MKV')).toBe('mkv')
    expect(fileExtension('backup.tar.gz')).toBe('gz')
    expect(fileExtension('.gitignore')).toBe('')
    expect(fileExtension('README')).toBe('')
    expect(fileExtension('trailing.')).toBe('')
  })

  it('maps names to categories', () => {
    expect(fileCategory('a.mp4')).toBe('video')
    expect(fileCategory('b.HEIC')).toBe('image')
    expect(fileCategory('c.flac')).toBe('audio')
    expect(fileCategory('d.pdf')).toBe('document')
    expect(fileCategory('e.7z')).toBe('archive')
    expect(fileCategory('f.tsx')).toBe('code')
    expect(fileCategory('setup.exe')).toBe('app')
    expect(fileCategory('kernel32.dll')).toBe('system')
    expect(fileCategory('win.iso')).toBe('disk-image')
    expect(fileCategory('notes')).toBe('other')
    expect(fileCategory('x.unknownext')).toBe('other')
  })

  it('finds the dominant category only above half', () => {
    expect(dominantCategory(vector({ 0: 60, 1: 40 }))).toBe('video')
    expect(dominantCategory(vector({ 0: 50, 1: 50 }))).toBe('video')
    expect(dominantCategory(vector({ 0: 40, 1: 30, 2: 30 }))).toBeNull()
    expect(dominantCategory(vector({}))).toBeNull()
  })

  it('orders category shares largest first and drops empty ones', () => {
    expect(categoryShares(vector({ 3: 10, 0: 10, 9: 30 }))).toEqual([
      { category: 'other', bytes: 30 },
      { category: 'video', bytes: 10 },
      { category: 'document', bytes: 10 },
    ])
    expect(categoryShares(vector({}))).toEqual([])
  })
})
