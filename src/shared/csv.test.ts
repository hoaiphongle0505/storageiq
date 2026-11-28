import { describe, expect, it } from 'vitest'
import { csvField, csvLine, toCsv } from './csv'

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

  it('writes a date as ISO 8601 in UTC and an empty cell as nothing', () => {
    expect(csvField(new Date(Date.UTC(2026, 10, 19, 12)))).toBe('2026-11-19T12:00:00.000Z')
    expect(csvField(null)).toBe('')
  })

  it('prefixes text that a spreadsheet could read as a formula, but never numbers', () => {
    expect(csvField('=1+1')).toBe("'=1+1")
    expect(csvField('+SUM(A1)')).toBe("'+SUM(A1)")
    expect(csvField('-2')).toBe("'-2")
    expect(csvField('@cmd')).toBe("'@cmd")
    expect(csvField('\tx')).toBe("'\tx")
    expect(csvField('\rx')).toBe('"\'\rx"')
    expect(csvField('a=b')).toBe('a=b')
    expect(csvField(-5)).toBe('-5')
    expect(csvField('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"')
  })
})

describe('toCsv and csvLine', () => {
  it('writes a header and one CRLF-terminated line per row', () => {
    expect(toCsv(['A', 'B'], [['x', 1]])).toBe('A,B\r\nx,1\r\n')
    expect(toCsv(['A'], [])).toBe('A\r\n')
    expect(csvLine(['a', null, 2])).toBe('a,,2\r\n')
  })
})
