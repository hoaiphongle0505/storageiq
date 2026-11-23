// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeDone } from '../test/scan-fixtures'
import { Ribbon } from './Ribbon'

function renderRibbon(api = createFakeApi()) {
  const onAbout = vi.fn()
  const utils = renderWithStores(<Ribbon onAbout={onAbout} />, api)
  return { ...utils, onAbout }
}

const toolbar = () => screen.getByRole('toolbar')
const command = (name: RegExp | string) => within(toolbar()).getByRole('button', { name })

describe('<Ribbon />', () => {
  it('has File, Home, Scan and View tabs with Home selected', () => {
    renderRibbon()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['File', 'Home', 'Scan', 'View'])
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('Home')
    expect(toolbar()).toHaveAccessibleName('Home commands')
  })

  it('marks the selected tab with an underline in Highlight when colours are forced', () => {
    renderRibbon()
    const { className } = screen.getByRole('tab', { name: 'Home' })
    expect(className).toContain('forced-colors:aria-selected:underline')
    expect(className).toContain('forced-colors:aria-selected:decoration-[Highlight]')
  })

  it('groups the Home commands into Scan, Mode, Unit and Folder', () => {
    renderRibbon()
    expect(
      within(toolbar())
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-labelledby') && g.textContent),
    ).toHaveLength(4)
    for (const name of ['Scan', 'Mode', 'Unit', 'Folder']) {
      expect(within(toolbar()).getByRole('group', { name })).toBeInTheDocument()
    }
    expect(command(/^Select/)).toHaveAttribute('aria-haspopup', 'menu')
    expect(command('Stop')).toHaveAttribute('aria-disabled', 'true')
    expect(command('Refresh')).toHaveAttribute('aria-disabled', 'true')
  })

  it('switches tabs with the arrow keys (selection follows focus)', async () => {
    const user = userEvent.setup()
    renderRibbon()
    screen.getByRole('tab', { name: 'Home' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Scan' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Scan' })).toHaveAttribute('aria-selected', 'true')
    expect(within(toolbar()).getByRole('group', { name: 'Tree' })).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(within(toolbar()).getByRole('button', { name: 'Treemap' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('makes the toolbar one tab stop with arrow-key movement', async () => {
    const user = userEvent.setup()
    renderRibbon()
    const select = command(/^Select/)
    expect(select).toHaveAttribute('tabindex', '0')
    expect(command('Stop')).toHaveAttribute('tabindex', '-1')
    select.focus()
    await user.keyboard('{ArrowRight}')
    expect(command('Stop')).toHaveFocus()
  })

  it('toggles the Mode and the Unit', async () => {
    const user = userEvent.setup()
    const { workspace } = renderRibbon()
    expect(command('Size')).toHaveAttribute('aria-pressed', 'true')
    await user.click(command('Allocated'))
    expect(workspace.getState().mode).toBe('allocated')
    expect(command('Allocated')).toHaveAttribute('aria-pressed', 'true')
    expect(command('Size')).toHaveAttribute('aria-pressed', 'false')
    await user.click(command('MB'))
    expect(workspace.getState().unit).toBe('mb')
    expect(command('MB')).toHaveAttribute('aria-pressed', 'true')
  })

  it('enables Stop during a scan and Refresh after it', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderRibbon()
    await act(() => workspace.getState().startScan('D:\\'))
    expect(command('Stop')).not.toHaveAttribute('aria-disabled')
    await user.click(command('Stop'))
    expect(api.cancelScan).toHaveBeenCalledWith('scan-1')
    act(() => api.emitScanDone(makeDone({ status: 'canceled' })))
    await user.click(command('Refresh'))
    expect(api.startScan).toHaveBeenCalledTimes(2)
  })

  it('expands the tree by levels from the Expand menu', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderRibbon()
    await act(() => workspace.getState().startScan('D:\\'))
    await user.click(command(/^Expand/))
    await user.click(screen.getByRole('menuitem', { name: '3 levels' }))
    expect(api.getExpandIds).toHaveBeenCalledWith('scan-1', 'd0', 3)
    await user.click(command(/^Expand/))
    await user.click(screen.getByRole('menuitem', { name: 'All levels' }))
    expect(api.getExpandIds).toHaveBeenLastCalledWith('scan-1', 'd0', 64)
  })

  it('opens the selected item in Explorer and creates a folder in it', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderRibbon()
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => api.emitScanDone(makeDone()))
    await user.click(command('Open in Explorer'))
    expect(api.openInExplorer).toHaveBeenCalledWith('scan-1', 'd0')
    await user.click(command('New folder'))
    expect(api.createFolder).toHaveBeenCalledWith('scan-1', 'd0')
  })

  it('File holds About and Exit; View toggles the treemap', async () => {
    const user = userEvent.setup()
    const { api, onAbout, workspace } = renderRibbon()
    await user.click(screen.getByRole('tab', { name: 'File' }))
    await user.click(command('About'))
    expect(onAbout).toHaveBeenCalled()
    await user.click(command('Exit'))
    expect(api.quit).toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'View' }))
    await user.click(command('Treemap'))
    expect(workspace.getState().treemapVisible).toBe(false)
  })
})
