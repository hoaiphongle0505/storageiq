import { describe, expect, it } from 'vitest'
import {
  MAX_TYPE_ICON_KEYS,
  totalSize,
  typeCategoryLabel,
  typeIconKey,
  typeIconKeys,
  typeLabel,
} from './side-view-model'

const ext = (name: string) => ({ kind: 'extension' as const, ext: name })

describe('typeLabel and typeCategoryLabel', () => {
  it('name the three kinds of row', () => {
    expect(typeLabel(ext('jpg'))).toBe('.jpg')
    expect(typeLabel({ kind: 'none', ext: '' })).toBe('(no extension)')
    expect(typeLabel({ kind: 'other', ext: '' })).toBe('Other extensions')
    expect(typeCategoryLabel({ category: 'video' })).toBe('Video')
    expect(typeCategoryLabel({ category: null })).toBe('')
  })
})

describe('typeIconKey', () => {
  it('is ext:<extension> for a normal extension and file for files without one', () => {
    expect(typeIconKey(ext('jpg'))).toBe('ext:jpg')
    expect(typeIconKey({ kind: 'none', ext: '' })).toBe('file')
  })

  it('is null for the "other" row and for an extension main would refuse', () => {
    expect(typeIconKey({ kind: 'other', ext: '' })).toBeNull()
    expect(typeIconKey(ext('a'.repeat(17)))).toBeNull()
    expect(typeIconKey(ext('a b'))).toBeNull()
    expect(typeIconKey(ext('é'))).toBeNull()
  })
})

describe('typeIconKeys', () => {
  it('lists each key once, skips rows without one and stops at 64', () => {
    expect(
      typeIconKeys([ext('jpg'), ext('jpg'), ext('bad ext'), { kind: 'none', ext: '' }]),
    ).toEqual(['ext:jpg', 'file'])
    const many = Array.from({ length: 100 }, (_, i) => ext(`e${i}`))
    expect(typeIconKeys(many)).toHaveLength(MAX_TYPE_ICON_KEYS)
  })
})

describe('totalSize', () => {
  it('adds the sizes', () => {
    expect(totalSize([{ size: 1 }, { size: 2 }, { size: 4 }])).toBe(7)
    expect(totalSize([])).toBe(0)
  })
})
