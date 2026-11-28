import { describe, expect, it } from 'vitest'
import { ageCsv, topFilesCsv, typesCsv } from './csv'
import { TEST_AGE, TEST_TOP_FILES, TEST_TYPES } from '../test/fake-api'

describe('the list CSVs', () => {
  it('Top files: name, folder, raw bytes and ISO dates', () => {
    expect(topFilesCsv(TEST_TOP_FILES)).toBe(
      [
        'Name,Folder,Size (bytes),Allocated (bytes),Modified (UTC)',
        'movie.mp4,D:\\Videos,536870912,536870912,2026-11-19T12:00:00.000Z',
        '"holiday, 2025.jpg",D:\\Photos,12582912,12587008,2024-06-01T12:00:00.000Z',
        '',
      ].join('\r\n'),
    )
  })

  it('Types: the extension as shown, the file type and raw numbers', () => {
    expect(typesCsv(TEST_TYPES)).toBe(
      [
        'Extension,Category,Size (bytes),Allocated (bytes),Files',
        '.mp4,Video,2147483648,2147483648,10',
        '.jpg,Images,805306368,813694976,1000',
        '(no extension),Other,268435456,268435456,3',
        '',
      ].join('\r\n'),
    )
  })

  it('Types: the "Other extensions" row has no category', () => {
    const csv = typesCsv([
      { kind: 'other', ext: '', category: null, size: 5, allocated: 4096, files: 2 },
    ])
    expect(csv.split('\r\n')[1]).toBe('Other extensions,,5,4096,2')
  })

  it('Age: all 8 buckets', () => {
    const lines = ageCsv(TEST_AGE).split('\r\n')
    expect(lines[0]).toBe('Age,Size (bytes),Allocated (bytes),Files')
    expect(lines).toHaveLength(1 + 8 + 1)
    expect(lines[1]).toBe('Last 30 days,2147483648,2147483648,10')
    expect(lines[2]).toBe('1–3 months,0,0,0')
    expect(lines[8]).toBe('Unknown date,268435456,268435456,3')
  })
})
