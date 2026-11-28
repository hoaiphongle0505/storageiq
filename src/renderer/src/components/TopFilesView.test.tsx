// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { topFilesCsv } from '../lib/csv'
import { formatDate, formatSize } from '../lib/format'
import { GONE_MESSAGE } from '../stores/workspace-store'
import { createFakeApi, TEST_TOP_FILES } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { LOAD_ERROR_TEXT } from './SideViewParts'
import { SINGLE_ITEM_MESSAGE } from './TreeGrid'
import { NO_FILES_TEXT, TopFilesView } from './TopFilesView'

async function renderView(api = createFakeApi()) {
  const utils = renderWithStores(<TopFilesView height={260} />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  await screen.findByRole('row', { name: /movie\.mp4/ })
  return utils
}

const grid = () => screen.getByRole('grid', { name: 'Largest files' })
const row = (name: RegExp) => screen.getByRole('row', { name })

describe('<TopFilesView />', () => {
  it('lists the files with every column, under tabs and the folder name', async () => {
    await renderView()
    expect(screen.getByRole('region', { name: 'Top files' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Top files' })).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Name',
      'Size▼',
      'Allocated',
      'Modified',
      'Folder',
    ])
    const [movie, holiday] = TEST_TOP_FILES
    expect(
      within(row(/movie\.mp4/))
        .getAllByRole('gridcell')
        .map((cell) => cell.textContent),
    ).toEqual([
      'movie.mp4',
      formatSize(movie!.size, 'auto'),
      formatSize(movie!.allocated, 'auto'),
      formatDate(movie!.modifiedMs),
      'D:\\Videos',
    ])
    expect(within(row(/holiday/)).getAllByRole('gridcell')[4]).toHaveAttribute(
      'title',
      holiday!.folder,
    )
  })

  it('asks for the treemap folder and ranks by allocated size in Allocated mode', async () => {
    const { api, workspace } = await renderView()
    expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd0', 'size')
    act(() => workspace.getState().setMode('allocated'))
    await waitFor(() =>
      expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd0', 'allocated'),
    )
    expect(
      screen.getAllByRole('columnheader').find((h) => h.getAttribute('aria-sort') !== null),
    ).toHaveTextContent('Allocated')
    act(() => workspace.getState().select('d1'))
    await waitFor(() =>
      expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd1', 'allocated'),
    )
  })

  it('shows the calm message when the folder is gone', async () => {
    const utils = renderWithStores(
      <TopFilesView height={260} />,
      createFakeApi({ getTopFiles: vi.fn(async () => null) }),
    )
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(GONE_MESSAGE)).toBeInTheDocument()
  })

  it('clears the selection when the folder changes', async () => {
    const { workspace } = await renderView()
    fireEvent.click(row(/movie\.mp4/))
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
    act(() => workspace.getState().select('d2'))
    await waitFor(() => expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'false'))
  })

  it('says the view could not load when the call fails', async () => {
    const utils = renderWithStores(
      <TopFilesView height={260} />,
      createFakeApi({
        getTopFiles: vi.fn(async () => {
          throw new Error('scanner busy')
        }),
      }),
    )
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(LOAD_ERROR_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('says so when the folder has no files', async () => {
    const utils = renderWithStores(
      <TopFilesView height={260} />,
      createFakeApi({ getTopFiles: vi.fn(async () => []) }),
    )
    await act(() => utils.workspace.getState().startScan('D:\\'))
    expect(await screen.findByText(NO_FILES_TEXT)).toBeInTheDocument()
  })

  it('selects with the mouse like the tree, and the Explorer menu acts on the selection', async () => {
    const { api } = await renderView()
    fireEvent.click(row(/movie\.mp4/))
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(row(/holiday/), { ctrlKey: true })
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
    expect(row(/holiday/)).toHaveAttribute('aria-selected', 'true')
    fireEvent.contextMenu(row(/holiday/), { clientX: 10, clientY: 20 })
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['f1', 'f2'], 10, 20, false),
    )
    // A right-click outside the selection selects just that row.
    fireEvent.click(row(/movie\.mp4/))
    fireEvent.contextMenu(row(/holiday/), { clientX: 5, clientY: 6, shiftKey: true })
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenLastCalledWith('scan-1', ['f2'], 5, 6, true),
    )
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'false')
  })

  it('moves and selects with the keyboard; Enter, the menu key and Ctrl+C reuse the tree actions', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderView()
    grid().focus()
    await user.keyboard('{ArrowDown}')
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
    expect(grid()).toHaveAttribute('aria-activedescendant', 'top-row-f1')
    await user.keyboard('{ArrowDown}')
    expect(row(/holiday/)).toHaveAttribute('aria-selected', 'true')
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'false')
    await user.keyboard('{Home}')
    expect(row(/movie\.mp4/)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(api.openInExplorer).toHaveBeenCalledWith('scan-1', 'f1')
    await user.keyboard('{Control>}c{/Control}')
    expect(api.copyNodePath).toHaveBeenCalledWith('scan-1', ['f1'])
    await user.keyboard('{Shift>}{F10}{/Shift}')
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['f1'], 32, 0, false),
    )
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(row(/holiday/)).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')
    expect(workspace.getState().announcement).toBe(SINGLE_ITEM_MESSAGE)
  })

  it('Ctrl+A selects every row and Escape keeps only the active one', async () => {
    const user = userEvent.setup()
    await renderView()
    grid().focus()
    await user.keyboard('{ArrowDown}{Control>}a{/Control}')
    expect(screen.getAllByRole('row', { selected: true })).toHaveLength(2)
    await user.keyboard('{Escape}')
    expect(screen.getAllByRole('row', { selected: true })).toHaveLength(1)
  })

  it('a double-click reveals the file in the folder tree', async () => {
    const { api, workspace } = await renderView()
    fireEvent.doubleClick(row(/movie\.mp4/))
    await waitFor(() => expect(workspace.getState().selectedId).toBe('f1'))
    expect(api.getNode).toHaveBeenCalledWith('scan-1', 'f1', 'size', 'desc')
    expect(workspace.getState().expanded.has('d1')).toBe(true)
  })

  it('Copy as CSV sends the whole list through main', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderView()
    await user.click(screen.getByRole('button', { name: 'Copy as CSV' }))
    expect(api.copyText).toHaveBeenCalledWith(topFilesCsv(TEST_TOP_FILES))
    await waitFor(() => expect(workspace.getState().announcement).toBe('Copied 2 rows.'))
  })

  it('asks for the icons of the rows in view', async () => {
    const { api } = await renderView()
    await waitFor(() => expect(api.getIcons).toHaveBeenCalledWith('scan-1', ['f1', 'f2']))
  })
})
