import { describe, expect, it } from 'vitest'
import { barLengths, donutPath, MIN_SLICE_DEGREES, pieSlices } from './chart-geometry'

const sweep = (slice: { startDeg: number; endDeg: number }) => slice.endDeg - slice.startDeg

describe('pieSlices', () => {
  it('starts at 12 o’clock, follows the input order and fills exactly 360°', () => {
    const slices = pieSlices([50, 30, 20])
    expect(slices.map((slice) => slice.index)).toEqual([0, 1, 2])
    expect(slices[0]).toMatchObject({ startDeg: 0, endDeg: 180, share: 0.5 })
    expect(slices[1]?.startDeg).toBeCloseTo(180)
    expect(slices[1]?.endDeg).toBeCloseTo(288)
    expect(slices[2]?.endDeg).toBe(360)
  })

  it('gives a value of zero no slice but keeps the index of the others', () => {
    const slices = pieSlices([0, 10, 0, 10])
    expect(slices.map((slice) => slice.index)).toEqual([1, 3])
    expect(slices.reduce((sum, slice) => sum + sweep(slice), 0)).toBeCloseTo(360)
  })

  it('widens a tiny slice to 1° and takes the difference from the others', () => {
    const slices = pieSlices([1_000_000, 1])
    expect(sweep(slices[1]!)).toBe(MIN_SLICE_DEGREES)
    expect(sweep(slices[0]!)).toBeCloseTo(359)
    expect(slices[1]?.endDeg).toBe(360)
  })

  it('keeps every slice at 1° or more when widening one shrinks another under 1°', () => {
    const slices = pieSlices([100_000, 1_000, 280, 1, 1, 1, 1, 1, 1, 1])
    for (const slice of slices) {
      expect(sweep(slice)).toBeGreaterThanOrEqual(MIN_SLICE_DEGREES - 1e-9)
    }
    expect(slices.reduce((sum, slice) => sum + sweep(slice), 0)).toBeCloseTo(360)
  })

  it('is one full turn for one value, and nothing for no value', () => {
    expect(pieSlices([7])).toEqual([{ index: 0, share: 1, startDeg: 0, endDeg: 360 }])
    expect(pieSlices([])).toEqual([])
    expect(pieSlices([0, 0])).toEqual([])
  })
})

describe('donutPath', () => {
  it('draws a quarter turn with the small arc, clockwise', () => {
    expect(donutPath(80, 80, 70, 40, 0, 90)).toBe(
      'M 80 10 A 70 70 0 0 1 150 80 L 120 80 A 40 40 0 0 0 80 40 Z',
    )
  })

  it('uses the large arc past a half turn', () => {
    expect(donutPath(80, 80, 70, 40, 0, 270)).toContain('A 70 70 0 1 1')
  })

  it('draws the whole circle as two half turns on each edge', () => {
    const path = donutPath(80, 80, 70, 40, 0, 360)
    expect(path.match(/A 70 70/g)).toHaveLength(2)
    expect(path.match(/A 40 40/g)).toHaveLength(2)
  })
})

describe('barLengths', () => {
  it('scales each bar by the longest one', () => {
    expect(barLengths([50, 100, 0, 25])).toEqual([0.5, 1, 0, 0.25])
  })

  it('is all zero when there is nothing to show', () => {
    expect(barLengths([])).toEqual([])
    expect(barLengths([0, 0])).toEqual([0, 0])
  })
})
