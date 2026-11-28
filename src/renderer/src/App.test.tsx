// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { EMPTY_TREE_TEXT } from './components/TreeGrid'
import { SCAN_CRASH_MESSAGE } from './stores/workspace-store'
import { createFakeApi, TEST_APP_INFO } from './test/fake-api'
import { renderWithStores } from './test/render'
import { makeDone, makeFailed, makeProgress } from './test/scan-fixtures'

describe('<App />', () => {
  it('opens on the empty workspace: ribbon, column tree, treemap pane and status bar', async () => {
    renderWithStores(<App />)
    expect(screen.getByRole('tablist', { name: 'Ribbon' })).toBeInTheDocument()
    expect(screen.getByRole('treegrid', { name: 'Folder tree' })).toBeInTheDocument()
    expect(screen.getByText(EMPTY_TREE_TEXT)).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Treemap' })).toBeInTheDocument()
    expect(screen.getByRole('separator', { name: 'Resize treemap' })).toBeInTheDocument()
    expect(await screen.findByText(`StorageIQ ${TEST_APP_INFO.version}`)).toBeInTheDocument()
  })

  it('scans a drive picked from Select and fills the tree as the scan runs', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<App />)
    await user.click(screen.getByRole('button', { name: /^Select/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Local Disk (C:)' }))
    expect(api.startScan).toHaveBeenCalledWith('C:\\')
    expect(await screen.findByRole('row', { name: /Videos/ })).toBeInTheDocument()
    act(() => api.emitScanProgress(makeProgress()))
    expect(screen.getByRole('contentinfo')).toHaveTextContent('420 files found')
    act(() => api.emitScanDone(makeDone()))
    expect(screen.getByRole('contentinfo')).toHaveTextContent('1,014 files found')
  })

  it('shows the crash banner, and Retry scans again', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<App />)
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => api.emitScanFailed(makeFailed()))
    expect(screen.getByRole('alert')).toHaveTextContent(SCAN_CRASH_MESSAGE)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.startScan).toHaveBeenCalledTimes(2)
  })

  it('hides the treemap and its splitter, and shows them again from View', async () => {
    const user = userEvent.setup()
    renderWithStores(<App />)
    await user.click(screen.getByRole('button', { name: 'Hide treemap' }))
    expect(screen.queryByRole('region', { name: 'Treemap' })).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'View' }))
    await user.click(screen.getByRole('button', { name: 'Treemap' }))
    expect(screen.getByRole('region', { name: 'Treemap' })).toBeInTheDocument()
  })

  it('shows each side view in the bottom pane from its tab, and the ribbon follows', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<App />)
    await act(() => workspace.getState().startScan('D:\\'))
    expect(await screen.findByRole('region', { name: 'Treemap' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Top files' }))
    expect(await screen.findByRole('region', { name: 'Top files' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Treemap' })).not.toBeInTheDocument()
    expect(await screen.findByRole('row', { name: /movie\.mp4/ })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Types' }))
    expect(await screen.findByRole('region', { name: 'Types' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Age' }))
    expect(await screen.findByRole('region', { name: 'Age' })).toBeInTheDocument()
    expect(api.getAgeBreakdown).toHaveBeenCalledWith('scan-1', 'd0')
    await user.click(screen.getByRole('tab', { name: 'View' }))
    expect(screen.getByRole('button', { name: 'Age' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Treemap' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(screen.getByRole('button', { name: 'Top files' }))
    expect(await screen.findByRole('region', { name: 'Top files' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Top files' }))
    expect(screen.queryByRole('region', { name: 'Top files' })).not.toBeInTheDocument()
  })

  it('F5 scans the same location again', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<App />)
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => api.emitScanDone(makeDone()))
    await user.keyboard('{F5}')
    expect(api.startScan).toHaveBeenCalledTimes(2)
  })

  it('About opens from the Help tab', async () => {
    const user = userEvent.setup()
    renderWithStores(<App />)
    await user.click(screen.getByRole('tab', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'About' }))
    expect(screen.getByRole('dialog', { name: 'About StorageIQ' })).toHaveTextContent('MIT license')
  })

  it("What's new does not stack over About", async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(<App />)
    await user.click(screen.getByRole('tab', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'About' }))
    act(() => workspace.getState().openWhatsNew({ kind: 'installed', version: '0.2.0' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'About StorageIQ' })).toBeInTheDocument()
  })

  it("the What's new dialog opens from the banner", async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<App />)
    act(() => api.emitUpdateState({ kind: 'available', version: '0.3.0' }))
    await user.click(screen.getByRole('button', { name: "What's new" }))
    expect(screen.getByRole('dialog', { name: "What's new" })).toBeInTheDocument()
  })

  it('F5 does nothing while a key is held or a dialog is open', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<App />)
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => api.emitScanDone(makeDone()))
    fireEvent.keyDown(window, { key: 'F5', repeat: true })
    expect(api.startScan).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('tab', { name: 'Help' }))
    await user.click(screen.getByRole('button', { name: 'About' }))
    fireEvent.keyDown(window, { key: 'F5' })
    expect(api.startScan).toHaveBeenCalledTimes(1)
  })

  it('subscribes before it takes the pending launch request', async () => {
    const order: string[] = []
    const api = createFakeApi({
      onLaunchRequest: vi.fn(() => {
        order.push('subscribe')
        return () => undefined
      }),
      takeLaunchRequest: vi.fn(async () => {
        order.push('take')
        return { kind: 'scan' as const, path: 'D:\\Data' }
      }),
    })
    renderWithStores(<App />, api)
    await waitFor(() => expect(api.startScan).toHaveBeenCalledWith('D:\\Data'))
    expect(order).toEqual(['subscribe', 'take'])
  })

  it('unsubscribes on unmount', () => {
    const unsubscribe = vi.fn()
    const { unmount } = renderWithStores(
      <App />,
      createFakeApi({ onLaunchRequest: vi.fn(() => unsubscribe) }),
    )
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('shows the confirmation dialog while scanning', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<App />)
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => api.emitLaunchRequest({ kind: 'scan', path: 'E:\\Games' }))
    const dialog = await screen.findByRole('dialog', { name: 'Scan another folder?' })
    expect(dialog).toHaveTextContent('StorageIQ is still scanning D:\\.')
    expect(dialog).toHaveTextContent('Stop it and scan E:\\Games instead?')
    await user.click(screen.getByRole('button', { name: 'Keep current scan' }))
    expect(screen.queryByRole('dialog', { name: 'Scan another folder?' })).toBeNull()
    act(() => api.emitLaunchRequest({ kind: 'scan', path: 'E:\\Games' }))
    await user.click(await screen.findByRole('button', { name: 'Scan Games' }))
    expect(api.startScan).toHaveBeenLastCalledWith('E:\\Games')
  })
})
