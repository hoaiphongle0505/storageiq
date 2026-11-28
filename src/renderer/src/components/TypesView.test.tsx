// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { typesCsv } from '../lib/csv'
import { formatCount, formatShare, formatSize } from '../lib/format'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { createFakeApi, TEST_TYPES } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { LOAD_ERROR_TEXT } from './SideViewParts'
import { NO_TYPES_TEXT, TypesView } from './TypesView'

async function renderView(api = createFakeApi()) {
  const utils = renderWithStores(<TypesView height={260} />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  await screen.findByRole('row', { name: /\.mp4/ })
  return utils
}

const table = () => screen.getByRole('table', { name: 'File types in this folder' })

describe('<TypesView />', () => {
  it('lists each extension with its type, sizes, file count and share of the folder', async () => {
    await renderView()
    expect(screen.getByRole('region', { name: 'Types' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Extension',
      'Category',
      'Size',
      'Allocated',
      'Files',
      '% of folder',
    ])
    const [mp4, jpg, none] = TEST_TYPES
    const total = TEST_TYPES.reduce((sum, row) => sum + row.size, 0)
    const cells = (name: RegExp) =>
      within(screen.getByRole('row', { name }))
        .getAllByRole('cell')
        .map((cell) => cell.textContent)
    expect(cells(/\.mp4/)).toEqual([
      '.mp4',
      'Video',
      formatSize(mp4!.size, 'auto'),
      formatSize(mp4!.allocated, 'auto'),
      formatCount(mp4!.files),
      formatShare(mp4!.size / total),
    ])
    expect(cells(/\.jpg/)[1]).toBe('Images')
    expect(cells(/\(no extension\)/)).toEqual([
      '(no extension)',
      'Other',
      formatSize(none!.size, 'auto'),
      formatSize(none!.allocated, 'auto'),
      formatCount(none!.files),
      formatShare(none!.size / total),
    ])
    expect(jpg!.files).toBe(1000)
    expect(within(table()).getAllByRole('row')).toHaveLength(1 + TEST_TYPES.length)
  })

  it('says the view could not load when the call fails, and Try again loads it', async () => {
    const user = userEvent.setup()
    const getTypeBreakdown = vi
      .fn<() => Promise<typeof TEST_TYPES | null>>()
      .mockRejectedValueOnce(new Error('scanner busy'))
      .mockResolvedValue(TEST_TYPES)
    const utils = renderWithStores(<TypesView height={260} />, createFakeApi({ getTypeBreakdown }))
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(LOAD_ERROR_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(GONE_MESSAGE)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('row', { name: /\.mp4/ })).toBeInTheDocument()
  })

  it('shows the colour of each file type and no colour for "Other extensions"', async () => {
    const api = createFakeApi({
      getTypeBreakdown: vi.fn(async () => [
        ...TEST_TYPES,
        { kind: 'other' as const, ext: '', category: null, size: 1, allocated: 4096, files: 1 },
      ]),
    })
    await renderView(api)
    const swatches = (name: RegExp) =>
      screen.getByRole('row', { name }).querySelectorAll('[style*="--treemap-"]')
    expect(swatches(/\.mp4/)[0]?.getAttribute('style')).toContain('var(--treemap-video)')
    expect(swatches(/Other extensions/)).toHaveLength(0)
  })

  it('asks for Windows’ icons by type key', async () => {
    const { api } = await renderView()
    await waitFor(() =>
      expect(api.getTypeIcons).toHaveBeenCalledWith(['ext:mp4', 'ext:jpg', 'file']),
    )
  })

  it('Copy as CSV sends the whole list through main', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderView()
    await user.click(screen.getByRole('button', { name: 'Copy as CSV' }))
    expect(api.copyText).toHaveBeenCalledWith(typesCsv(TEST_TYPES))
    await waitFor(() => expect(workspace.getState().announcement).toBe('Copied 3 rows.'))
  })

  it('asks for the treemap folder again when it changes', async () => {
    const { api, workspace } = await renderView()
    expect(api.getTypeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd0')
    act(() => workspace.getState().select('d1'))
    await waitFor(() => expect(api.getTypeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd1'))
  })

  it('shows the calm message when the folder is gone or has no files', async () => {
    const gone = renderWithStores(
      <TypesView height={260} />,
      createFakeApi({ getTypeBreakdown: vi.fn(async () => null) }),
    )
    await act(() => gone.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(GONE_MESSAGE)).toBeInTheDocument()
    gone.unmount()

    const empty = renderWithStores(
      <TypesView height={260} />,
      createFakeApi({ getTypeBreakdown: vi.fn(async () => []) }),
    )
    await act(() => empty.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(NO_TYPES_TEXT)).toBeInTheDocument()
  })

  it('notes that the results are partial while the scan runs', async () => {
    await renderView()
    expect(screen.getByText(/Scanning…/)).toBeInTheDocument()
  })
})
