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
      expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['d2'], 120, 80, true),
    )
    grid().focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(api.showContextMenu).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.showContextMenu).mock.calls[1]?.[1]).toEqual(['d2'])
    await user.keyboard('{Control>}c{/Control}')
    await waitFor(() => expect(api.copyNodePath).toHaveBeenCalledWith('scan-1', ['d2']))
    await user.keyboard('{Control>}n{/Control}')
    expect(api.createFolder).toHaveBeenCalledWith('scan-1', 'd2')
  })

  it('lets keyboard users sort from a header without opening Explorer or moving the selection', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderTree()
    const selectedBefore = workspace.getState().selectedId
    screen.getByRole('button', { name: /^Name/ }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(api.getChildren).toHaveBeenLastCalledWith('scan-1', 'd0', 'name', 'asc', 0, 200),
    )
    expect(api.openInExplorer).not.toHaveBeenCalled()
    await user.keyboard('{ArrowDown}{End}{Home}')
    expect(workspace.getState().selectedId).toBe(selectedBefore)
  })

  it('expands with a click on the row twice and toggles with the chevron', async () => {
    const user = userEvent.setup()
    await renderTree()
    await user.dblClick(screen.getByRole('row', { name: /Videos/ }))
    expect(await screen.findByRole('row', { name: /movie|\[1 file\]/ })).toBeInTheDocument()
    await user.dblClick(screen.getByRole('row', { name: /Videos/ }))
    await waitFor(() =>
      expect(screen.queryByRole('row', { name: /Clips/ })).not.toBeInTheDocument(),
    )
    const videos = () => screen.getByRole('row', { name: /Videos/ })
    const chevron = () => videos().querySelector('[data-chevron]') as SVGElement
    await user.click(chevron())
    expect(await screen.findByRole('row', { name: /Clips/ })).toBeInTheDocument()
    expect(videos()).toHaveAttribute('aria-expanded', 'true')
    await user.click(chevron())
    await waitFor(() =>
      expect(screen.queryByRole('row', { name: /Clips/ })).not.toBeInTheDocument(),
    )
    expect(videos()).toHaveAttribute('aria-expanded', 'false')
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

describe('<TreeGrid /> multi-select', () => {
  const rowOf = (name: RegExp) => screen.getByRole('row', { name })
  const selectedIds = (workspace: Awaited<ReturnType<typeof renderTree>>['workspace']) =>
    [...workspace.getState().selectedIds].sort()
  const press = async (keys: string) => {
    grid().focus()
    await userEvent.setup().keyboard(keys)
  }

  it('the grid is multiselectable and every row has aria-selected', async () => {
    await renderTree()
    expect(grid()).toHaveAttribute('aria-multiselectable', 'true')
    const rows = screen.getAllByRole('row').filter((row) => row.id.startsWith('tree-row-'))
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(['true', 'false']).toContain(row.getAttribute('aria-selected'))
    }
    // The header row has no selection state.
    expect(screen.getAllByRole('row')[0]).not.toHaveAttribute('aria-selected')
    expect(rowOf(/D:\\/)).toHaveAttribute('aria-selected', 'true')
    expect(rowOf(/Videos/)).toHaveAttribute('aria-selected', 'false')
  })

  it('click selects one row and clears the others', async () => {
    const user = userEvent.setup()
    const { workspace } = await renderTree()
    await user.click(rowOf(/Videos/))
    await user.click(rowOf(/Photos/))
    expect(selectedIds(workspace)).toEqual(['d2'])
    expect(rowOf(/Videos/)).toHaveAttribute('aria-selected', 'false')
    expect(rowOf(/Photos/)).toHaveAttribute('aria-selected', 'true')
  })

  it('ctrl click toggles a row without clearing the others', async () => {
    const user = userEvent.setup()
    const { workspace } = await renderTree()
    await user.click(rowOf(/Videos/))
    fireEvent.click(rowOf(/Photos/), { ctrlKey: true })
    expect(selectedIds(workspace)).toEqual(['d1', 'd2'])
    expect(workspace.getState().selectedId).toBe('d2')
    fireEvent.click(rowOf(/Videos/), { ctrlKey: true })
    expect(selectedIds(workspace)).toEqual(['d2'])
    // Ctrl+click does not expand or collapse.
    expect(rowOf(/Videos/)).toHaveAttribute('aria-expanded', 'false')
  })

  it('shift click selects a range in visible order', async () => {
    const user = userEvent.setup()
    const { workspace } = await renderTree()
    await user.click(rowOf(/Videos/))
    fireEvent.click(screen.getByRole('row', { name: /\[3 files\]/ }), { shiftKey: true })
    expect(selectedIds(workspace)).toEqual(['d1', 'd2', 'g0'])
    expect(workspace.getState().selectedId).toBe('g0')
    expect(workspace.getState().anchorId).toBe('d1')
  })

  it('shift click ignores collapsed descendants', async () => {
    const user = userEvent.setup()
    const { workspace } = await renderTree()
    // Videos is collapsed: its children are not visible and are not part of the range.
    await user.click(rowOf(/D:\\/))
    fireEvent.click(screen.getByRole('row', { name: /\[3 files\]/ }), { shiftKey: true })
    expect(selectedIds(workspace)).toEqual(['d0', 'd1', 'd2', 'g0'])
    expect(rowOf(/Videos/)).toHaveAttribute('aria-expanded', 'false')
  })

  it('ctrl shift click adds a range', async () => {
    const user = userEvent.setup()
    const { workspace } = await renderTree()
    await user.click(rowOf(/D:\\/))
    fireEvent.click(screen.getByRole('row', { name: /\[3 files\]/ }), { ctrlKey: true })
    fireEvent.click(rowOf(/Videos/), { ctrlKey: true, shiftKey: true })
    expect(selectedIds(workspace)).toEqual(['d0', 'd1', 'd2', 'g0'])
  })

  it('ctrl A selects all visible rows', async () => {
    const { workspace } = await renderTree()
    await press('{Control>}a{/Control}')
    expect(selectedIds(workspace)).toEqual(['d0', 'd1', 'd2', 'g0'])
    expect(workspace.getState().selectedId).toBe('d0')
  })

  it('shift arrow down extends the selection by one row', async () => {
    const { workspace } = await renderTree()
    await press('{Shift>}{ArrowDown}{/Shift}')
    expect(selectedIds(workspace)).toEqual(['d0', 'd1'])
    expect(workspace.getState().selectedId).toBe('d1')
    await userEvent.setup().keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(selectedIds(workspace)).toEqual(['d0', 'd1', 'd2'])
  })

  it('ctrl arrow moves the active row without changing the selection', async () => {
    const { workspace } = await renderTree()
    await press('{Control>}{ArrowDown}{ArrowDown}{/Control}')
    expect(workspace.getState().selectedId).toBe('d2')
    expect(selectedIds(workspace)).toEqual(['d0'])
    expect(grid()).toHaveAttribute('aria-activedescendant', 'tree-row-d2')
  })

  it('space toggles the active row and ctrl space does too', async () => {
    const { workspace } = await renderTree()
    await press('{ArrowDown}')
    expect(selectedIds(workspace)).toEqual(['d1'])
    await userEvent.setup().keyboard(' ')
    expect(selectedIds(workspace)).toEqual([])
    expect(workspace.getState().selectedId).toBe('d1')
    await userEvent.setup().keyboard(' ')
    expect(selectedIds(workspace)).toEqual(['d1'])
    await userEvent.setup().keyboard('{Control>} {/Control}')
    expect(selectedIds(workspace)).toEqual([])
  })

  it('escape reduces a multi selection to the active row', async () => {
    const { workspace } = await renderTree()
    await press('{Shift>}{ArrowDown}{ArrowDown}{/Shift}')
    expect(selectedIds(workspace)).toEqual(['d0', 'd1', 'd2'])
    await userEvent.setup().keyboard('{Escape}')
    expect(selectedIds(workspace)).toEqual(['d2'])
    expect(workspace.getState().selectedId).toBe('d2')
  })

  it('the active row has a focus ring that differs from the selected style', async () => {
    const { workspace } = await renderTree()
    await press('{Control>}{ArrowDown}{/Control}')
    expect(selectedIds(workspace)).toEqual(['d0'])
    // d1 is active but not selected; d0 is selected but not active.
    expect(rowOf(/Videos/)).toHaveAttribute('data-active')
    expect(rowOf(/Videos/).className).not.toContain('bg-selection')
    expect(rowOf(/D:\\/)).not.toHaveAttribute('data-active')
    expect(rowOf(/D:\\/).className).toContain('bg-selection')
    expect(document.querySelectorAll('[data-active]')).toHaveLength(1)
  })

  it('the selection survives a chunk reload', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderTree()
    await user.click(rowOf(/Videos/))
    fireEvent.click(rowOf(/Photos/), { ctrlKey: true })
    const calls = vi.mocked(api.getChildren).mock.calls.length
    act(() => api.emitScanProgress(makeProgress()))
    await waitFor(() => expect(vi.mocked(api.getChildren).mock.calls.length).toBeGreaterThan(calls))
    expect(selectedIds(workspace)).toEqual(['d1', 'd2'])
    expect(rowOf(/Videos/)).toHaveAttribute('aria-selected', 'true')
  })

  it('right click inside the selection opens the menu for all selected rows', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderTree()
    await user.click(rowOf(/Photos/))
    fireEvent.click(rowOf(/Videos/), { ctrlKey: true })
    fireEvent.contextMenu(rowOf(/Photos/), { clientX: 120, clientY: 80 })
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['d1', 'd2'], 120, 80, false),
    )
    // The set is unchanged; the clicked row is the active one.
    expect(selectedIds(workspace)).toEqual(['d1', 'd2'])
    expect(workspace.getState().selectedId).toBe('d2')
  })

  it('right click outside the selection selects that row and opens the menu for it', async () => {
    const user = userEvent.setup()
    const { api, workspace } = await renderTree()
    await user.click(rowOf(/Videos/))
    fireEvent.click(rowOf(/Photos/), { ctrlKey: true })
    fireEvent.contextMenu(screen.getByRole('row', { name: /\[3 files\]/ }), {
      clientX: 5,
      clientY: 6,
    })
    await waitFor(() =>
      expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['g0'], 5, 6, false),
    )
    expect(selectedIds(workspace)).toEqual(['g0'])
  })

  it('shift F10 opens the menu for the whole selection at the active row', async () => {
    const { api } = await renderTree()
    await userEvent.setup().click(rowOf(/Videos/))
    await press('{Shift>}{ArrowDown}{ArrowDown}{/Shift}')
    await userEvent.setup().keyboard('{Shift>}{F10}{/Shift}')
    await waitFor(() => expect(api.showContextMenu).toHaveBeenCalledTimes(1))
    expect(vi.mocked(api.showContextMenu).mock.calls[0]?.[1]).toEqual(['d1', 'd2'])
  })

  it('Ctrl+C copies the paths of every selected row', async () => {
    const { api } = await renderTree()
    await press('{Shift>}{ArrowDown}{/Shift}')
    await userEvent.setup().keyboard('{Control>}c{/Control}')
    await waitFor(() => expect(api.copyNodePath).toHaveBeenCalledWith('scan-1', ['d0', 'd1']))
  })

  it('selecting more than 1000 rows announces the limit and opens no menu', async () => {
    const { api, workspace } = await renderTree()
    const ids = Array.from({ length: 1001 }, (_, i) => `f${i + 100}`)
    act(() =>
      workspace.getState().setSelection({ ids: new Set(ids), activeId: 'd0', anchorId: 'd0' }),
    )
    await press('{Shift>}{F10}{/Shift}')
    await waitFor(() =>
      expect(workspace.getState().announcement).toBe(
        'Too many items selected (the limit is 1,000).',
      ),
    )
    expect(api.showContextMenu).not.toHaveBeenCalled()
  })

  it('enter with several rows announces select a single item first', async () => {
    const { api, workspace } = await renderTree()
    await press('{Shift>}{ArrowDown}{/Shift}')
    await userEvent.setup().keyboard('{Enter}')
    expect(workspace.getState().announcement).toBe('Select a single item first.')
    expect(api.openInExplorer).not.toHaveBeenCalled()
    await userEvent.setup().keyboard('{Control>}n{/Control}')
    expect(api.createFolder).not.toHaveBeenCalled()
  })

  it('rows request icons for the rendered window only', async () => {
    const api = createFakeApi()
    await renderTree(api)
    await waitFor(() => expect(api.getIcons).toHaveBeenCalled())
    const asked = vi.mocked(api.getIcons).mock.calls.flatMap(([, ids]) => ids)
    // The root, its two folders and nothing else: the "[3 files]" row (g0) has no icon of its
    // own, and the rows inside the collapsed Videos folder are not rendered.
    expect([...asked].sort()).toEqual(['d0', 'd1', 'd2'])
    expect(vi.mocked(api.getIcons).mock.calls.every(([scanId]) => scanId === 'scan-1')).toBe(true)
    await userEvent.setup().dblClick(screen.getByRole('row', { name: /Videos/ }))
    await screen.findByRole('row', { name: /Clips/ })
    await waitFor(() => {
      const more = vi.mocked(api.getIcons).mock.calls.flatMap(([, ids]) => ids)
      expect(more).toContain('d3')
    })
    const all = vi.mocked(api.getIcons).mock.calls.flatMap(([, ids]) => ids)
    expect(all.filter((id) => id === 'd1')).toHaveLength(1) // never asked twice
    expect(all.some((id) => id.startsWith('g'))).toBe(false)
  })

  it('a row shows its img after the fake api answers', async () => {
    const api = createFakeApi({
      getIcons: vi.fn(async (_scan: string, ids: string[]) => ({
        keys: Object.fromEntries(ids.map((id) => [id, 'dir'])),
        images: {
          dir: { small: 'data:image/png;base64,FOLDER', large: 'data:image/png;base64,FOLDER2' },
        },
        pending: [],
      })),
    })
    await renderTree(api)
    const videos = screen.getByRole('row', { name: /Videos/ })
    await waitFor(() => expect(videos.querySelector('img[data-icon]')).not.toBeNull())
    const image = videos.querySelector('img[data-icon]') as HTMLImageElement
    expect(image).toHaveAttribute('data-icon', 'dir')
    expect(image).toHaveAttribute('src', 'data:image/png;base64,FOLDER')
    expect(image.closest('[data-file-icon]')).toHaveClass('size-4')
    // The "[N files]" row keeps its placeholder.
    expect(screen.getByRole('row', { name: /\[3 files\]/ }).querySelector('img')).toBeNull()
  })

  it('icons and chevrons are aria-hidden svgs and the rows keep their accessible names', async () => {
    await renderTree()
    const videos = screen.getByRole('row', { name: /Videos/ })
    for (const svg of videos.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
    expect(videos.querySelector('[data-chevron]')).not.toBeNull()
  })
})
