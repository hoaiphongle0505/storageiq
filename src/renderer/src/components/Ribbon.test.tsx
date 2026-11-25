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
  it('has the tabs File, Home, Scan, View and Options in that order', () => {
    renderRibbon()
    const tabs = screen.getAllByRole('tab')
    // Options follows View; Help stays last.
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'File',
      'Home',
      'Scan',
      'View',
      'Options',
      'Help',
    ])
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

  it('Open in Explorer and New folder are disabled while several rows are selected', async () => {
    const { api, workspace } = renderRibbon()
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => api.emitScanDone(makeDone()))
    expect(command('Open in Explorer')).not.toHaveAttribute('aria-disabled')
    act(() =>
      workspace
        .getState()
        .setSelection({ ids: new Set(['d0', 'd1']), activeId: 'd1', anchorId: 'd0' }),
    )
    expect(command('Open in Explorer')).toHaveAttribute('aria-disabled', 'true')
    expect(command('New folder')).toHaveAttribute('aria-disabled', 'true')
    act(() => workspace.getState().select('d1'))
    expect(command('Open in Explorer')).not.toHaveAttribute('aria-disabled')
  })

  it('the File tab keeps Exit and no longer has About; View toggles the treemap', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderRibbon()
    await user.click(screen.getByRole('tab', { name: 'File' }))
    expect(within(toolbar()).queryByRole('button', { name: 'About' })).not.toBeInTheDocument()
    await user.click(command('Exit'))
    expect(api.quit).toHaveBeenCalled()
    await user.click(screen.getByRole('tab', { name: 'View' }))
    await user.click(command('Treemap'))
    expect(workspace.getState().treemapVisible).toBe(false)
  })

  it('the Options tab shows the Application group', async () => {
    const user = userEvent.setup()
    renderRibbon()
    await user.click(screen.getByRole('tab', { name: 'Options' }))
    expect(toolbar()).toHaveAccessibleName('Options commands')
    expect(within(toolbar()).getByRole('group', { name: 'Application' })).toBeInTheDocument()
    expect(within(toolbar()).getAllByRole('checkbox')).toHaveLength(2)
  })

  it('arrow keys reach the Options tab', async () => {
    const user = userEvent.setup()
    renderRibbon()
    screen.getByRole('tab', { name: 'View' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Options' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Options' })).toHaveAttribute('aria-selected', 'true')
  })

  it('the Help tab is last and shows the Help and Version groups', async () => {
    const user = userEvent.setup()
    renderRibbon()
    const tabs = screen.getAllByRole('tab')
    expect(tabs[tabs.length - 1]).toHaveTextContent('Help')
    await user.click(screen.getByRole('tab', { name: 'Help' }))
    expect(toolbar()).toHaveAccessibleName('Help commands')
    expect(within(toolbar()).getByRole('group', { name: 'Help' })).toBeInTheDocument()
    expect(within(toolbar()).getByRole('group', { name: 'Version' })).toBeInTheDocument()
    for (const name of ['Help', 'Report a problem', 'About', 'Check for updates', "What's new"]) {
      expect(command(name)).toBeInTheDocument()
    }
  })

  it('Help and Report a problem call openLink with help and issues', async () => {
    const user = userEvent.setup()
    const { api } = renderRibbon()
    await user.click(screen.getByRole('tab', { name: 'Help' }))
    await user.click(command('Help'))
    await user.click(command('Report a problem'))
    expect(api.openLink).toHaveBeenNthCalledWith(1, 'help')
    expect(api.openLink).toHaveBeenNthCalledWith(2, 'issues')
  })

  it('About opens the About dialog', async () => {
    const user = userEvent.setup()
    const { onAbout } = renderRibbon()
    await user.click(screen.getByRole('tab', { name: 'Help' }))
    await user.click(command('About'))
    expect(onAbout).toHaveBeenCalledTimes(1)
  })

  it('Check for updates calls checkForUpdates and opens the About dialog', async () => {
    const user = userEvent.setup()
    const { api, onAbout } = renderRibbon()
    await user.click(screen.getByRole('tab', { name: 'Help' }))
    await user.click(command('Check for updates'))
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(onAbout).toHaveBeenCalledTimes(1)
  })

  it("What's new opens the history target", async () => {
    const user = userEvent.setup()
    const { workspace } = renderRibbon()
    await user.click(screen.getByRole('tab', { name: 'Help' }))
    await user.click(command("What's new"))
    expect(workspace.getState().whatsNew).toEqual({ kind: 'history' })
  })

  it('the Help tab and the Check for updates button show a dot while an update is available, downloading or ready', async () => {
    const user = userEvent.setup()
    const { api } = renderRibbon()
    for (const state of [
      { kind: 'available' as const, version: '0.3.0' },
      { kind: 'downloading' as const, version: '0.3.0', percent: 5 },
      { kind: 'ready' as const, version: '0.3.0' },
    ]) {
      act(() => api.emitUpdateState(state))
      const tab = screen.getByRole('tab', { name: 'Help, update available' })
      expect(tab.querySelector('[data-testid="notification-dot"]')).not.toBeNull()
      expect(tab).toHaveTextContent(/^Help$/)
      await user.click(tab)
      const button = command('Check for updates, update available')
      expect(button.querySelector('[data-testid="notification-dot"]')).toHaveAttribute(
        'aria-hidden',
        'true',
      )
      expect(button).toHaveAttribute('title', 'Check whether a newer StorageIQ is available')
    }
  })

  it('the dot stays while a download error is shown', async () => {
    const { api } = renderRibbon()
    act(() => api.emitUpdateState({ kind: 'error', message: 'x', during: 'download' }))
    expect(screen.getByRole('tab', { name: 'Help, update available' })).toBeInTheDocument()
  })

  it('no dot when idle, checking, up-to-date or error', async () => {
    const user = userEvent.setup()
    const { api } = renderRibbon()
    for (const state of [
      { kind: 'idle' as const },
      { kind: 'checking' as const },
      { kind: 'up-to-date' as const },
      { kind: 'error' as const, message: 'x', during: 'check' as const },
    ]) {
      act(() => api.emitUpdateState(state))
      await user.click(screen.getByRole('tab', { name: 'Help' }))
      expect(document.querySelector('[data-testid="notification-dot"]')).toBeNull()
    }
  })

  it('its icons are aria-hidden svgs and its accessible name is unchanged', () => {
    renderRibbon()
    for (const name of ['Stop', 'Refresh', 'Size', 'Allocated', 'File count', 'Percent']) {
      const button = command(name)
      expect(button).toHaveAccessibleName(name)
      const svgs = button.querySelectorAll('svg')
      expect(svgs).toHaveLength(1)
      expect(svgs[0]).toHaveAttribute('aria-hidden', 'true')
      expect(svgs[0]).toHaveAttribute('focusable', 'false')
    }
    expect(command(/^Select/)).toHaveAccessibleName('Select')
    expect(command(/^Expand/)).toHaveAccessibleName('Expand')
    for (const svg of toolbar().querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
    // Colour glyphs (Refresh, Percent) are marked so forced colours leave them alone.
    expect(command('Refresh').querySelector('svg')).toHaveAttribute('data-color-icon')
    expect(command('Stop').querySelector('svg')).not.toHaveAttribute('data-color-icon')
    // High contrast: an inline style, because Griffel's unlayered rule beats a layered one.
    expect(command('Refresh').querySelector('svg')?.getAttribute('style')).toContain(
      'forced-color-adjust: none',
    )
    expect(command('Stop').querySelector('svg')?.getAttribute('style') ?? '').not.toContain(
      'forced-color-adjust',
    )
    // A disabled button dims colour and tinted glyphs too (they ignore currentColor).
    expect(command('Refresh').className).toContain('aria-disabled:[&_svg]:opacity-40')
  })
})
