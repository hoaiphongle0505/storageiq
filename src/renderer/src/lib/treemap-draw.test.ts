import { describe, expect, it, vi } from 'vitest'
import type { TreemapLayout, TreemapRect } from '@shared/tree-types'
import { drawTreemap, fillFor, hitTest, rectLabel, type TreemapColors } from './treemap-draw'

const COLORS: TreemapColors = {
  levels: ['#l0', '#l1', '#l2'],
  files: '#files',
  free: '#free',
  edge: '#edge',
  outline: '#outline',
  text: '#text',
}

function rect(fields: Partial<TreemapRect>): TreemapRect {
  return {
    id: 'd1',
    kind: 'folder',
    name: 'Videos',
    value: 2 * 1024 ** 3,
    files: 10,
    depth: 0,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    nested: false,
    ...fields,
  }
}

const LAYOUT: TreemapLayout = {
  nodeId: 'd0',
  width: 200,
  height: 100,
  rects: [
    rect({ id: 'd1', w: 120, h: 100, nested: true }),
    rect({ id: 'd4', name: 'Inner', depth: 1, x: 2, y: 18, w: 60, h: 40 }),
    rect({ id: null, kind: 'free', name: 'Free space', x: 120, w: 80, h: 100 }),
  ],
}

describe('hitTest', () => {
  it('finds the deepest block under the point', () => {
    expect(hitTest(LAYOUT, 10, 30)?.id).toBe('d4')
    expect(hitTest(LAYOUT, 100, 90)?.id).toBe('d1')
    expect(hitTest(LAYOUT, 150, 50)?.kind).toBe('free')
    expect(hitTest(LAYOUT, 250, 50)).toBeNull()
  })
})

describe('fillFor and rectLabel', () => {
  it('colours by depth, files and free space', () => {
    expect(fillFor(rect({ depth: 0 }), COLORS)).toBe('#l0')
    expect(fillFor(rect({ depth: 4 }), COLORS)).toBe('#l1')
    expect(fillFor(rect({ kind: 'files' }), COLORS)).toBe('#files')
    expect(fillFor(rect({ kind: 'free' }), COLORS)).toBe('#free')
  })

  it('labels with the name and the Mode value', () => {
    expect(rectLabel(rect({}), 'size', 'auto')).toBe('Videos (2.0 GB)')
    expect(rectLabel(rect({ kind: 'files', name: '', files: 7 }), 'allocated', 'gb')).toBe(
      '[7 files] (2.0 GB)',
    )
    expect(rectLabel(rect({ value: 1234 }), 'files', 'auto')).toBe('Videos (1,234 files)')
  })
})

describe('drawTreemap', () => {
  it('fills every block, labels the ones that fit and outlines the selected one', () => {
    const calls: string[] = []
    const ctx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(() => calls.push('fill')),
      strokeRect: vi.fn(),
      fillText: vi.fn((text: string) => calls.push(`text:${text}`)),
      measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
      set fillStyle(value: string) {
        calls.push(`style:${value}`)
      },
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      textBaseline: 'alphabetic',
    } as unknown as CanvasRenderingContext2D
    drawTreemap(ctx, LAYOUT, { colors: COLORS, selectedId: 'd4', mode: 'size', unit: 'auto' })
    expect(calls.filter((call) => call === 'fill')).toHaveLength(3)
    expect(calls).toContain('style:#free')
    expect(calls.some((call) => call.startsWith('text:Videos'))).toBe(true)
    expect(calls.some((call) => call.startsWith('text:Free space'))).toBe(true)
    expect(ctx.strokeRect).toHaveBeenLastCalledWith(3, 19, 58, 38)
  })
})
