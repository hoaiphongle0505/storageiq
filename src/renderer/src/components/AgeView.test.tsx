// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AGE_BUCKETS } from '@shared/tree-types'
import { ageCsv } from '../lib/csv'
import { formatCount, formatShare, formatSize } from '../lib/format'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { createFakeApi, TEST_AGE } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { AgeView } from './AgeView'

async function renderView(api = createFakeApi()) {
  const utils = renderWithStores(<AgeView height={260} />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  await screen.findByRole('row', { name: /Last 30 days/ })
  return utils
}

describe('<AgeView />', () => {
  it('lists all 8 buckets in order, empty ones too, with sizes, files and shares', async () => {
    await renderView()
    expect(screen.getByRole('region', { name: 'Age' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Age',
      'Size',
      'Allocated',
      'Files',
      '% of folder',
    ])
    const body = screen.getAllByRole('row').slice(1)
    expect(body.map((row) => within(row).getByRole('rowheader').textContent)).toEqual(
      AGE_BUCKETS.map((bucket) => bucket.label),
    )
    const total = TEST_AGE.reduce((sum, row) => sum + row.size, 0)
    const recent = TEST_AGE[0]!
    expect(
      within(body[0]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual([
      formatSize(recent.size, 'auto'),
      formatSize(recent.allocated, 'auto'),
      formatCount(recent.files),
      formatShare(recent.size / total),
    ])
    expect(within(body[1]!).getAllByRole('cell')[2]).toHaveTextContent('0')
    expect(within(body[1]!).getAllByRole('cell')[3]).toHaveTextContent('0.0%')
  })

  it('Copy as CSV sends all 8 buckets through main', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderView()
    await user.click(screen.getByRole('button', { name: 'Copy as CSV' }))
    expect(api.copyText).toHaveBeenCalledWith(ageCsv(TEST_AGE))
    await waitFor(() => expect(workspace.getState().announcement).toBe('Copied 8 rows.'))
  })

  it('asks for the treemap folder of the current scan again when it changes', async () => {
    const { api, workspace } = await renderView()
    expect(api.getAgeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd0')
    act(() => workspace.getState().select('d2'))
    await waitFor(() => expect(api.getAgeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd2'))
  })

  it('shows the calm message when the folder is gone', async () => {
    const utils = renderWithStores(
      <AgeView height={260} />,
      createFakeApi({ getAgeBreakdown: vi.fn(async () => null) }),
    )
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(GONE_MESSAGE)).toBeInTheDocument()
  })
})
