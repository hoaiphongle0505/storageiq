import { describe, expect, it } from 'vitest'
import {
  categoryTotals,
  chartSummary,
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

describe('categoryTotals', () => {
  const row = (category: 'video' | 'image' | null, size: number) => ({
    kind: 'extension' as const,
    ext: 'x',
    category,
    size,
    allocated: size,
    files: 1,
  })

  it('sums the rows per file type, biggest first, without empty types', () => {
    expect(
      categoryTotals([row('image', 10), row('video', 5), row('image', 20), row('video', 0)]),
    ).toEqual([
      { category: 'image', bytes: 30 },
      { category: 'video', bytes: 5 },
    ])
  })

  it('counts the "Other extensions" row (no category) as Other', () => {
    expect(categoryTotals([row('video', 5), row(null, 9)])).toEqual([
      { category: 'other', bytes: 9 },
      { category: 'video', bytes: 5 },
    ])
  })

  it('is empty for no rows', () => {
    expect(categoryTotals([])).toEqual([])
  })
})

describe('chartSummary', () => {
  it('names the three biggest entries with their rounded share', () => {
    expect(
      chartSummary([
        { label: 'Images', value: 12 },
        { label: 'Video', value: 41 },
        { label: 'Audio', value: 2 },
        { label: 'Documents', value: 22 },
        { label: 'Code', value: 0 },
      ]),
    ).toBe('Video 53 %, Documents 29 %, Images 16 %')
  })

  it('says there is no data when everything is zero', () => {
    expect(chartSummary([{ label: 'Video', value: 0 }])).toBe('No data')
    expect(chartSummary([])).toBe('No data')
  })
})
