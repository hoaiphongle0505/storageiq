// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TreemapLayout, TreemapRect } from '@shared/tree-types'
import { formatBytes, formatShare } from '../lib/format'
import { legendItems, TreemapLegend } from './TreemapLegend'

function rect(fields: Partial<TreemapRect>): TreemapRect {
  return {
    id: 'd1',
    kind: 'folder',
    name: 'Videos',
    value: 100,
    files: 1,
    depth: 0,
    x: 0,
    y: 0,
    w: 50,
    h: 50,
    nested: false,
    category: 'video',
    ...fields,
  }
}

function layout(rects: TreemapRect[], categories: TreemapLayout['categories']): TreemapLayout {
  return { nodeId: 'd0', width: 100, height: 100, rects, categories }
}

describe('<TreemapLegend />', () => {
  it('lists file types by share with their percentages', () => {
    const data = layout(
      [rect({})],
      [
        { category: 'video', bytes: 600 },
        { category: 'image', bytes: 300 },
        { category: 'other', bytes: 100 },
      ],
    )
    render(<TreemapLegend layout={data} />)
    const list = screen.getByRole('list', { name: 'File types in this folder' })
    const items = within(list).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([
      `Video${formatShare(0.6)}`,
      `Images${formatShare(0.3)}`,
      `Other${formatShare(0.1)}`,
    ])
    expect(legendItems(data).map((item) => item.kind)).toEqual(['category', 'category', 'category'])
  })

  it('colours swatches through CSS variables, never hex', () => {
    render(<TreemapLegend layout={layout([rect({})], [{ category: 'audio', bytes: 5 }])} />)
    const swatch = screen.getAllByRole('listitem')[0]?.querySelector('span[aria-hidden]')
    expect(swatch?.getAttribute('style')).toContain('var(--treemap-audio)')
  })

  it('draws the "Other" swatch as a filled chip, not an empty box', () => {
    render(<TreemapLegend layout={layout([rect({})], [{ category: 'other', bytes: 5 }])} />)
    const swatch = screen.getAllByRole('listitem')[0]?.querySelector('span[aria-hidden]')
    expect(swatch?.getAttribute('style')).toContain('background: var(--treemap-other)')
    expect(swatch).toHaveClass('border-line-strong')
    expect(swatch?.className).toContain('shadow-[inset_')
  })

  it('adds free space with its size and a mixed-folders key', () => {
    const data = layout(
      [
        rect({ id: null, kind: 'free', name: 'Free space', value: 2 * 1024 ** 3, category: null }),
        rect({ category: null }),
      ],
      [{ category: 'video', bytes: 10 }],
    )
    render(<TreemapLegend layout={data} />)
    const items = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(items).toEqual([
      `Video${formatShare(1)}`,
      `Free space${formatBytes(2 * 1024 ** 3)}`,
      'Mixed folders',
    ])
  })

  it('renders an empty legend for no layout', () => {
    const { container } = render(<TreemapLegend layout={null} />)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toBeNull()
  })
})
