import { describe, expect, it } from 'vitest'
import {
  filesRowName,
  formatBytes,
  formatCount,
  formatDate,
  formatDuration,
  formatModeValue,
  formatShare,
  formatSize,
  middleTruncate,
  percentOf,
  rowName,
  shareOfParent,
} from './format'

const GB = 1024 ** 3
const MB = 1024 ** 2

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(1_234_567)).toBe('1,234,567')
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [1023, '1,023 bytes'],
    [1024, '1.0 KB'],
    [5 * MB, '5.0 MB'],
    [150 * MB, '150 MB'],
    [3 * GB, '3.0 GB'],
    [2 * 1024 * GB, '2.0 TB'],
  ])('formats %d as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})

describe('formatSize', () => {
  it('uses Auto like formatBytes and forces a unit otherwise', () => {
    expect(formatSize(3 * GB, 'auto')).toBe('3.0 GB')
    expect(formatSize(3 * GB, 'gb')).toBe('3.0 GB')
    expect(formatSize(3 * GB, 'mb')).toBe('3,072.0 MB')
    expect(formatSize(512, 'kb')).toBe('0.5 KB')
    expect(formatSize(100 * MB, 'gb')).toBe('0.1 GB')
  })
})

describe('formatShare', () => {
  it('shows one decimal and marks tiny shares', () => {
    expect(formatShare(1)).toBe('100.0%')
    expect(formatShare(0.599)).toBe('59.9%')
    expect(formatShare(0)).toBe('0.0%')
    expect(formatShare(0.0001)).toBe('<0.1%')
  })
})

describe('formatDate', () => {
  it('formats a date and leaves unknown dates empty', () => {
    expect(formatDate(new Date(2026, 10, 19, 14, 30).getTime())).toBe('11/19/2026')
    expect(formatDate(0)).toBe('')
  })
})

describe('formatDuration', () => {
  it.each([
    [40, 'under 0.1 s'],
    [1500, '1.5 s'],
    [12_400, '12 s'],
    [125_000, '2 min 05 s'],
    [3_780_000, '1 h 03 min'],
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('percentOf and shareOfParent', () => {
  it('guards against a zero total', () => {
    expect(percentOf(5, 0)).toBe(0)
    expect(percentOf(1, 4)).toBe(0.25)
  })

  it('uses the Mode value; the root is 100%', () => {
    const row = { size: 100, allocated: 4096, files: 1 }
    const parent = { size: 400, allocated: 8192, files: 4 }
    expect(shareOfParent(row, parent, 'size')).toBe(0.25)
    expect(shareOfParent(row, parent, 'percent')).toBe(0.25)
    expect(shareOfParent(row, parent, 'allocated')).toBe(0.5)
    expect(shareOfParent(row, parent, 'files')).toBe(0.25)
    expect(shareOfParent(row, null, 'size')).toBe(1)
  })
})

describe('formatModeValue', () => {
  const row = { size: 3 * GB, allocated: 4 * GB, files: 1234 }
  it('shows the Mode value', () => {
    expect(formatModeValue(row, 'size', 'auto', 0.5)).toBe('3.0 GB')
    expect(formatModeValue(row, 'allocated', 'mb', 0.5)).toBe('4,096.0 MB')
    expect(formatModeValue(row, 'files', 'auto', 0.5)).toBe('1,234')
    expect(formatModeValue(row, 'percent', 'auto', 0.5)).toBe('50.0%')
  })
})

describe('row names', () => {
  it('names the "[N files]" row', () => {
    expect(filesRowName(1)).toBe('[1 file]')
    expect(filesRowName(1200)).toBe('[1,200 files]')
    expect(rowName({ kind: 'files', name: '', files: 7 })).toBe('[7 files]')
    expect(rowName({ kind: 'folder', name: 'Photos', files: 7 })).toBe('Photos')
  })
})

describe('middleTruncate', () => {
  it('keeps both ends of a long path', () => {
    expect(middleTruncate('short', 10)).toBe('short')
    const text = middleTruncate('C:\\a-very-long-folder-name\\file.txt', 15)
    expect(text).toHaveLength(15)
    expect(text.startsWith('C:\\a-v')).toBe(true)
    expect(text.endsWith('le.txt')).toBe(true)
  })
})
