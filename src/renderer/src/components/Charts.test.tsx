// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { formatShare, formatSize } from '../lib/format'
import { createFakeApi, TEST_AGE, TEST_TYPES } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { AgeChart } from './AgeChart'
import { ChartLayout, ChartToggle } from './ChartParts'
import { TypesChart } from './TypesChart'
import { AgeView } from './AgeView'
import { TypesView } from './TypesView'

describe('<TypesChart />', () => {
  it('is named by the three biggest file types and draws one slice per type', () => {
    renderWithStores(<TypesChart rows={TEST_TYPES} />)
    const chart = screen.getByRole('img')
    expect(chart).toHaveAccessibleName('Space by file type: Video 67 %, Images 25 %, Other 8 %')
    const slices = chart.querySelectorAll('path')
    expect(slices).toHaveLength(3)
    expect(slices[0]?.getAttribute('style')).toContain('var(--treemap-video)')
    expect(slices[1]?.getAttribute('style')).toContain('var(--treemap-image)')
    expect(slices[2]?.getAttribute('style')).toContain('var(--treemap-other)')
  })

  it('shows the total in the middle and a legend with each type, its size and its share', () => {
    renderWithStores(<TypesChart rows={TEST_TYPES} />)
    const total = TEST_TYPES.reduce((sum, row) => sum + row.size, 0)
    expect(screen.getByRole('img').querySelector('text:last-of-type')).toHaveTextContent(
      formatSize(total, 'auto'),
    )
    const items = within(screen.getByRole('list', { name: 'File types by size' })).getAllByRole(
      'listitem',
    )
    expect(items.map((item) => item.textContent)).toEqual([
      `Video${formatSize(2 * 1024 ** 3, 'auto')}${formatShare(2048 / 3072)}`,
      `Images${formatSize(768 * 1024 ** 2, 'auto')}${formatShare(0.25)}`,
      `Other${formatSize(256 * 1024 ** 2, 'auto')}${formatShare(256 / 3072)}`,
    ])
  })

  it('adds up the extensions of one type, and counts "Other extensions" as Other', () => {
    renderWithStores(
      <TypesChart
        rows={[
          { kind: 'extension', ext: 'mp4', category: 'video', size: 30, allocated: 30, files: 1 },
          { kind: 'extension', ext: 'mkv', category: 'video', size: 30, allocated: 30, files: 1 },
          { kind: 'other', ext: '', category: null, size: 40, allocated: 40, files: 2 },
        ]}
      />,
    )
    expect(screen.getByRole('img')).toHaveAccessibleName(
      'Space by file type: Video 60 %, Other 40 %',
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('draws nothing for a folder with no bytes', () => {
    const { container } = renderWithStores(<TypesChart rows={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('<AgeChart />', () => {
  it('draws a bar for each bucket that holds bytes, longest for the biggest', () => {
    renderWithStores(<AgeChart rows={TEST_AGE} />)
    const chart = screen.getByRole('img')
    expect(chart).toHaveAccessibleName(
      'Space by file age: Last 30 days 67 %, 2–5 years 25 %, Unknown date 8 %',
    )
    const bars = [...chart.querySelectorAll('rect')]
    expect(bars).toHaveLength(3)
    const widths = bars.map((bar) => Number(bar.getAttribute('width')))
    expect(widths[0]).toBe(200)
    expect(widths[1]).toBeCloseTo(75)
    expect(widths[2]).toBeCloseTo(25)
  })

  it('labels every bucket, empty ones too, and draws "Unknown date" in the muted colour', () => {
    renderWithStores(<AgeChart rows={TEST_AGE} />)
    const labels = [...screen.getByRole('img').querySelectorAll('text')].map((t) => t.textContent)
    expect(labels).toContain('Last 30 days')
    expect(labels).toContain('1–3 months')
    expect(labels).toContain('Unknown date')
    expect(labels).toContain(formatSize(0, 'auto'))
    const bars = [...screen.getByRole('img').querySelectorAll('rect')]
    expect(bars[0]).toHaveClass('fill-bar-fill')
    expect(bars[2]).toHaveClass('fill-ink-subtle')
  })

  it('gives a very small bucket a bar that can be seen', () => {
    const [first] = TEST_AGE
    renderWithStores(
      <AgeChart
        rows={[
          { ...first!, size: 1_000_000_000_000 },
          { ...first!, id: 'months-1-3', label: '1–3 months', size: 1 },
        ]}
      />,
    )
    const bars = [...screen.getByRole('img').querySelectorAll('rect')]
    expect(Number(bars[1]?.getAttribute('width'))).toBe(2)
  })
})

describe('the Chart toggle', () => {
  it('shows and hides the chart panel, and is pressed while it is shown', async () => {
    const user = userEvent.setup()
    renderWithStores(
      <>
        <ChartToggle />
        <ChartLayout chart={<p>the chart</p>}>
          <p>the table</p>
        </ChartLayout>
      </>,
    )
    const toggle = screen.getByRole('button', { name: 'Chart' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('the chart')).toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByText('the chart')).not.toBeInTheDocument()
    expect(screen.getByText('the table')).toBeInTheDocument()
  })
})

describe('the charts in the views', () => {
  it('Types shows its chart left of the table, and the toggle hides it', async () => {
    const user = userEvent.setup()
    const utils = renderWithStores(<TypesView height={260} />, createFakeApi())
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByRole('img', { name: /^Space by file type/ })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'File types in this folder' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chart' }))
    expect(screen.queryByRole('img', { name: /^Space by file type/ })).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'File types in this folder' })).toBeInTheDocument()
  })

  it('Age shows its chart, and the choice is shared with Types', async () => {
    const user = userEvent.setup()
    const utils = renderWithStores(<AgeView height={260} />, createFakeApi())
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByRole('img', { name: /^Space by file age/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chart' }))
    expect(utils.workspace.getState().chartVisible).toBe(false)
    expect(screen.queryByRole('img', { name: /^Space by file age/ })).not.toBeInTheDocument()
  })
})
