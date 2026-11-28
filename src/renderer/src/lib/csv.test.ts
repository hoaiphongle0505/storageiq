import { describe, expect, it } from 'vitest'
import { ageCsv, csvField, isoDate, toCsv, topFilesCsv, typesCsv } from './csv'
import { TEST_AGE, TEST_TOP_FILES, TEST_TYPES } from '../test/fake-api'

describe('csvField', () => {
  it('leaves plain text and numbers alone', () => {
    expect(csvField('movie.mp4')).toBe('movie.mp4')
    expect(csvField(1536)).toBe('1536')
    expect(csvField('')).toBe('')
  })

  it('quotes a field with a comma, a quote or a line break, and doubles the quotes', () => {
    expect(csvField('holiday, 2025.jpg')).toBe('"holiday, 2025.jpg"')
    expect(csvField('say "hi"')).toBe('"say ""hi"""')
    expect(csvField('a\nb')).toBe('"a\nb"')
    expect(csvField('a\r\nb')).toBe('"a\r\nb"')
  })
})

describe('toCsv', () => {
  it('writes a header and one CRLF-terminated line per row', () => {
    expect(toCsv(['A', 'B'], [['x', 1]])).toBe('A,B\r\nx,1\r\n')
    expect(toCsv(['A'], [])).toBe('A\r\n')
  })
})

describe('isoDate', () => {
  it('is ISO 8601 in UTC, and empty for an unknown date', () => {
    expect(isoDate(Date.UTC(2026, 10, 19, 12))).toBe('2026-11-19T12:00:00.000Z')
    expect(isoDate(0)).toBe('')
  })
})

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
