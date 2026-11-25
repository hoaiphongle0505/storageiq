// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TreemapLayout, TreemapRect } from '@shared/tree-types'
import {
  drawTreemap,
  fillFor,
  hitTest,
  readTreemapColors,
  rectLabel,
  type TreemapColors,
} from './treemap-draw'

const COLORS: TreemapColors = {
  categories: {
    video: '#c-video',
    image: '#c-image',
    audio: '#c-audio',
    document: '#c-document',
    archive: '#c-archive',
    code: '#c-code',
    app: '#c-app',
    system: '#c-system',
    'disk-image': '#c-disk-image',
    other: '#c-other',
  },
  folder: '#folder',
  free: '#free',
  freeHatch: '#hatch',
  edge: '#edge',
  accent: '#accent',
  halo: '#halo',
  text: '#text',
  cushionInner: '#inner',
  cushionOuter: '#outer',
  contrast: 'normal',
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
    category: 'video',
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
    rect({ id: null, kind: 'free', name: 'Free space', x: 120, w: 80, h: 100, category: null }),
  ],
  categories: [{ category: 'video', bytes: 2 * 1024 ** 3 }],
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
  it('fills by category, frames nested and mixed folders, and marks free space', () => {
    expect(fillFor(rect({ kind: 'file', category: 'image' }), COLORS)).toBe('#c-image')
    expect(fillFor(rect({ category: 'audio' }), COLORS)).toBe('#c-audio')
    expect(fillFor(rect({ category: 'audio', nested: true }), COLORS)).toBe('#folder')
    expect(fillFor(rect({ category: null }), COLORS)).toBe('#folder')
    expect(fillFor(rect({ kind: 'free', id: null, category: null }), COLORS)).toBe('#free')
    const forced: TreemapColors = { ...COLORS, contrast: 'forced' }
    for (const fields of [
      { kind: 'file' as const },
      { category: null },
      { kind: 'free' as const, category: null },
      { nested: true },
    ]) {
      expect(fillFor(rect(fields), forced)).toBe('Canvas')
    }
  })

  it('labels with the name and the Mode value', () => {
    expect(rectLabel(rect({}), 'size', 'auto')).toBe('Videos (2.0 GB)')
    expect(rectLabel(rect({ kind: 'files', name: '', files: 7 }), 'allocated', 'gb')).toBe(
      '[7 files] (2.0 GB)',
    )
    expect(rectLabel(rect({ value: 1234 }), 'files', 'auto')).toBe('Videos (1,234 files)')
  })
})

interface Recorded {
  ctx: CanvasRenderingContext2D
  fills: number[][]
  fillStyleAtFill: unknown[]
  strokes: { style: unknown; width: number; args: number[] }[]
  hatchStrokeStyles: unknown[]
  texts: string[]
  gradient: { addColorStop: ReturnType<typeof vi.fn> }
  mocks: Record<string, ReturnType<typeof vi.fn>>
}

function recorder(): Recorded {
  const fills: number[][] = []
  const fillStyleAtFill: unknown[] = []
  const strokes: Recorded['strokes'] = []
  const hatchStrokeStyles: unknown[] = []
  const texts: string[] = []
  const gradient = { addColorStop: vi.fn() }
  const mocks = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
  }
  const state = { fillStyle: '' as unknown, strokeStyle: '' as unknown, lineWidth: 1 }
  const ctx = {
    ...mocks,
    fillRect: vi.fn((...args: number[]) => {
      fills.push(args)
      fillStyleAtFill.push(state.fillStyle)
    }),
    strokeRect: vi.fn((...args: number[]) => {
      strokes.push({ style: state.strokeStyle, width: state.lineWidth, args })
    }),
    stroke: vi.fn(() => hatchStrokeStyles.push(state.strokeStyle)),
    fillText: vi.fn((text: string) => texts.push(text)),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
    get fillStyle() {
      return state.fillStyle
    },
    set fillStyle(value: unknown) {
      state.fillStyle = value
    },
    get strokeStyle() {
      return state.strokeStyle
    },
    set strokeStyle(value: unknown) {
      state.strokeStyle = value
    },
    get lineWidth() {
      return state.lineWidth
    },
    set lineWidth(value: number) {
      state.lineWidth = value
    },
    font: '',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D
  return { ctx, fills, strokes, fillStyleAtFill, hatchStrokeStyles, texts, gradient, mocks }
}

function layoutOf(...rects: TreemapRect[]): TreemapLayout {
  return { nodeId: 'd0', width: 200, height: 100, rects, categories: [] }
}

const DRAW = { selectedId: null, mode: 'size', unit: 'auto' } as const

describe('drawTreemap', () => {
  it('draws blocks inset by 1 px over the gap colour', () => {
    const r = recorder()
    drawTreemap(r.ctx, layoutOf(rect({ x: 10, y: 20, w: 50, h: 30 })), { colors: COLORS, ...DRAW })
    expect(r.fills[0]).toEqual([0, 0, 200, 100])
    expect(r.fillStyleAtFill[0]).toBe('#edge')
    expect(r.fills[1]).toEqual([11, 21, 48, 28])
    expect(r.fillStyleAtFill[1]).toBe('#c-video')
  })

  it('skips blocks thinner than 2 px', () => {
    const r = recorder()
    drawTreemap(r.ctx, layoutOf(rect({ w: 1.5 }), rect({ h: 1 })), { colors: COLORS, ...DRAW })
    expect(r.fills).toHaveLength(1)
  })

  it('adds the cushion only to large non-nested blocks in normal contrast', () => {
    const calls = (colors: TreemapColors, ...rects: TreemapRect[]) => {
      const r = recorder()
      drawTreemap(r.ctx, layoutOf(...rects), { colors, ...DRAW })
      return r
    }
    const big = rect({ kind: 'file', w: 40, h: 40 })
    const normal = calls(COLORS, big)
    expect(normal.mocks.createRadialGradient).toHaveBeenCalledTimes(1)
    expect(normal.mocks.createRadialGradient).toHaveBeenCalledWith(
      1 + 0.3 * 38,
      1 + 0.25 * 38,
      0,
      1 + 0.3 * 38,
      1 + 0.25 * 38,
      0.95 * 38,
    )
    expect(normal.gradient.addColorStop.mock.calls).toEqual([
      [0, '#inner'],
      [1, '#outer'],
    ])
    expect(calls(COLORS, rect({ w: 10, h: 40 })).mocks.createRadialGradient).not.toHaveBeenCalled()
    expect(
      calls(COLORS, rect({ w: 40, h: 40, nested: true })).mocks.createRadialGradient,
    ).not.toHaveBeenCalled()
    for (const contrast of ['more', 'forced'] as const) {
      expect(calls({ ...COLORS, contrast }, big).mocks.createRadialGradient).not.toHaveBeenCalled()
    }
  })

  it('hatches free space inside a clip', () => {
    const free = rect({ id: null, kind: 'free', name: 'Free space', category: null, w: 80, h: 60 })
    const r = recorder()
    drawTreemap(r.ctx, layoutOf(free), { colors: COLORS, ...DRAW })
    expect(r.mocks.save).toHaveBeenCalled()
    expect(r.mocks.clip).toHaveBeenCalled()
    expect(r.mocks.restore).toHaveBeenCalled()
    expect(r.hatchStrokeStyles).toEqual(['#hatch'])
    expect(r.mocks.createRadialGradient).not.toHaveBeenCalled()
    const forced = recorder()
    drawTreemap(forced.ctx, layoutOf(free), { colors: { ...COLORS, contrast: 'forced' }, ...DRAW })
    expect(forced.mocks.clip).not.toHaveBeenCalled()
    expect(forced.hatchStrokeStyles).toEqual([])
  })

  it('uses system colours in forced colours and ink gaps in more contrast', () => {
    const forced = recorder()
    drawTreemap(forced.ctx, layoutOf(rect({})), {
      colors: { ...COLORS, contrast: 'forced' },
      ...DRAW,
    })
    expect(forced.fillStyleAtFill[0]).toBe('CanvasText')
    expect(forced.fillStyleAtFill[1]).toBe('Canvas')
    const more = recorder()
    drawTreemap(more.ctx, layoutOf(rect({})), { colors: { ...COLORS, contrast: 'more' }, ...DRAW })
    expect(more.fillStyleAtFill[0]).toBe('#text')
  })

  it('labels the blocks that fit', () => {
    const r = recorder()
    drawTreemap(r.ctx, LAYOUT, { colors: COLORS, ...DRAW })
    expect(r.texts.some((text) => text.startsWith('Videos'))).toBe(true)
    expect(r.texts.some((text) => text.startsWith('Free space'))).toBe(true)
  })

  it('outlines the selected block with the accent and a halo', () => {
    const r = recorder()
    drawTreemap(r.ctx, LAYOUT, { colors: COLORS, selectedId: 'd4', mode: 'size', unit: 'auto' })
    expect(r.strokes).toEqual([
      { style: '#accent', width: 2, args: [4, 20, 56, 36] },
      { style: '#halo', width: 1, args: [6, 22, 52, 32] },
    ])
    const forced = recorder()
    drawTreemap(forced.ctx, LAYOUT, {
      colors: { ...COLORS, contrast: 'forced' },
      selectedId: 'd4',
      mode: 'size',
      unit: 'auto',
    })
    expect(forced.strokes).toHaveLength(1)
    expect(forced.strokes[0]).toMatchObject({ style: 'Highlight', width: 3 })
  })
})

describe('readTreemapColors', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stub = (matches: Record<string, boolean>) =>
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: matches[query] ?? false })),
    )

  it('reads the contrast mode from the media queries', () => {
    const element = document.createElement('div')
    stub({ '(forced-colors: active)': true, '(prefers-contrast: more)': true })
    expect(readTreemapColors(element).contrast).toBe('forced')
    stub({ '(prefers-contrast: more)': true })
    expect(readTreemapColors(element).contrast).toBe('more')
    stub({})
    expect(readTreemapColors(element).contrast).toBe('normal')
    vi.stubGlobal('matchMedia', undefined)
    expect(readTreemapColors(element).contrast).toBe('normal')
  })

  it('falls back to the light values without tokens', () => {
    const colors = readTreemapColors(document.createElement('div'))
    expect(colors.categories.video).toBe('#eba48c')
    expect(colors.cushionInner).toBe('rgba(255, 255, 255, 0.5)')
  })
})
