import { describe, expect, it } from 'vitest'
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatPercent,
  middleTruncate,
  percentOf,
} from './format'

describe('formatBytes', () => {
  it.each([
    [0, '0 bytes'],
    [1, '1 byte'],
    [1023, '1,023 bytes'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [150 * 1024, '150 KB'],
    [5 * 1024 ** 3, '5.0 GB'],
    [512 * 1024 ** 3, '512 GB'],
    [1.5 * 1024 ** 4, '1.5 TB'],
  ])('%d → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1_234_567)).toBe('1,234,567')
  })
})

describe('formatDuration', () => {
  it.each([
    [0, 'under 0.1 s'],
    [99, 'under 0.1 s'],
    [100, '0.1 s'],
    [870, '0.9 s'],
    [9_940, '9.9 s'],
    [12_400, '12 s'],
    [59_400, '59 s'],
    [125_000, '2 min 05 s'],
    [3_725_000, '1 h 02 min'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})

describe('percentages', () => {
  it.each([
    [0, '0%'],
    [0.004, '<1%'],
    [256 / 3072, '8%'],
    [2 / 3, '67%'],
    [1, '100%'],
  ])('%f → %s', (fraction, text) => {
    expect(formatPercent(fraction)).toBe(text)
  })

  it('computes a share and treats an empty total as 0', () => {
    expect(percentOf(1, 4)).toBe(0.25)
    expect(percentOf(5, 0)).toBe(0)
  })
})

describe('middleTruncate', () => {
  it('keeps short text as is', () => {
    expect(middleTruncate('C:\\Data', 20)).toBe('C:\\Data')
  })

  it('keeps the start and the end around an ellipsis', () => {
    expect(middleTruncate('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcde…wxyz')
  })
})
