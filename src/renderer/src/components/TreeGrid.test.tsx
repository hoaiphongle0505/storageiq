// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeDone, makeProgress } from '../test/scan-fixtures'
import { EMPTY_TREE_TEXT, TreeGrid } from './TreeGrid'

async function renderTree(api = createFakeApi()) {
  const utils = renderWithStores(<TreeGrid />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  await screen.findByRole('row', { name: /Videos/ })
  return utils
}

const grid = () => screen.getByRole('treegrid', { name: 'Folder tree' })
const cells = (name: RegExp) =>
  within(screen.getByRole('row', { name }))
    .getAllByRole('gridcell')
    .map((cell) => cell.textContent)

describe('<TreeGrid />', () => {
  it('shows the empty-state line before any scan', () => {
    renderWithStores(<TreeGrid />)
    expect(screen.getByText(EMPTY_TREE_TEXT)).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Name',
      'Size',
      'Allocated',
      'Files',
      'Folders',
      '% of Parent▼',
      'Last Modified',
    ])
  })

  it('shows the root, its folders and one "[N files]" row with every column', async () => {
    await renderTree()
    expect(cells(/^.*D:\\/)).toEqual([
      '3.0 GBD:\\',
      '3.0 GB',
      '3.0 GB',
      '1,014',
      '53',
      '100.0%',
      '11/19/2026',
    ])
    expect(cells(/Videos/)).toEqual([
      '2.0 GBVideos',
      '2.0 GB',
      '2.0 GB',
      '10',
      '1',
      '66.7%',
      '11/19/2026',
    ])
    expect(screen.getByRole('row', { name: /\[3 files\]/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Videos/ })).toHaveAttribute('aria-level', '2')
    expect(screen.getByRole('row', { name: /Videos/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('makes rows of 10% or more bold and draws the bar at the share of the parent', async () => {
    await renderTree()
    const videos = screen.getByRole('row', { name: /Videos/ })
    expect(videos.className).toContain('font-semibold')
    expect(within(videos).getByTestId('name-bar')).toHaveStyle({ width: '66.66666666666666%' })
    const files = screen.getByRole('row', { name: /\[3 files\]/ })
    expect(files.className).not.toContain('font-semibold')
  })

  it('keeps exact byte counts on the size cells', async () => {
    await renderTree()
    const [, size, allocated] = within(screen.getByRole('row', { name: /Photos/ })).getAllByRole(
      'gridcell',
    )
    expect(size).toHaveAttribute('data-bytes', String(768 * 1024 ** 2))
    expect(allocated).toHaveAttribute('title', '813,694,976 bytes')
  })

  it('sorts by a header and reverses on a second click', async () => {
    const user = userEvent.setup()
    const { api } = await renderTree()
    await user.click(screen.getByRole('button', { name: /^Name/ }))
    await waitFor(() =>
      expect(api.getChildren).toHaveBeenLastCalledWith('scan-1', 'd0', 'name', 'asc', 0, 200),
    )
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await user.click(screen.getByRole('button', { name: /^Name/ }))
    await waitFor(() =>
      expect(api.getChildren).toHaveBeenLastCalledWith('scan-1', 'd0', 'name', 'desc', 0, 200),
    )
  })

  it('moves with ↑ ↓, expands with →, collapses with ← and opens with Enter', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderTree()
    grid().focus()
    await user.keyboard('{ArrowDown}')
    expect(workspace.getState().selectedId).toBe('d1')
    expect(grid()).toHaveAttribute('aria-activedescendant', 'tree-row-d1')
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByRole('row', { name: /Clips/ })).toHaveAttribute('aria-level', '3')
    await user.keyboard('{ArrowRight}')
    expect(workspace.getState().selectedId).toBe('d3')
    await user.keyboard('{ArrowLeft}')
    expect(workspace.getState().selectedId).toBe('d1')
    await user.keyboard('{ArrowLeft}')
    expect(screen.queryByRole('row', { name: /Clips/ })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(api.openInExplorer).toHaveBeenCalledWith('scan-1', 'd1')
    await user.keyboard('{End}')
    expect(workspace.getState().selectedId).toBe('g0')
    await user.keyboard('{Home}')
    expect(workspace.getState().selectedId).toBe('d0')
  })

  it('opens the Explorer menu on right-click and on Shift+F10, copies with Ctrl+C, creates with Ctrl+N', async () => {
    const user = userEvent.setup()
    const { api } = await renderTree()
    fireEvent.contextMenu(screen.getByRole('row', { name: /Photos/ }), {
      clientX: 120,
      clientY: 80,
      shiftKey: true,
    })
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', 'd2', 120, 80, true),
    )
    grid().focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(api.showContextMenu).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.showContextMenu).mock.calls[1]?.[1]).toBe('d2')
    await user.keyboard('{Control>}c{/Control}')
    await waitFor(() => expect(api.copyNodePath).toHaveBeenCalledWith('scan-1', 'd2'))
    await user.keyboard('{Control>}n{/Control}')
    expect(api.createFolder).toHaveBeenCalledWith('scan-1', 'd2')
  })

  it('expands with a click on the row twice and toggles with the chevron', async () => {
    const user = userEvent.setup()
    await renderTree()
    await user.dblClick(screen.getByRole('row', { name: /Videos/ }))
    expect(await screen.findByRole('row', { name: /movie|\[1 file\]/ })).toBeInTheDocument()
  })

  it('refreshes the visible rows on every scanner update', async () => {
    const { api } = await renderTree()
    const calls = vi.mocked(api.getChildren).mock.calls.length
    act(() => api.emitScanProgress(makeProgress()))
    await waitFor(() => expect(vi.mocked(api.getChildren).mock.calls.length).toBeGreaterThan(calls))
    act(() => api.emitScanDone(makeDone()))
    await waitFor(() =>
      expect(vi.mocked(api.getChildren).mock.calls.length).toBeGreaterThan(calls + 1),
    )
  })
})
