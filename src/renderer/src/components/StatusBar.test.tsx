// @vitest-environment jsdom
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithStores } from '../test/render'
import { makeDone, makeProgress } from '../test/scan-fixtures'
import { StatusBar } from './StatusBar'

afterEach(() => {
  vi.useRealTimers()
})

async function renderBar() {
  const utils = renderWithStores(<StatusBar />)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  return utils
}

describe('<StatusBar />', () => {
  it('shows only the version before a scan', async () => {
    const { appStore } = renderWithStores(<StatusBar />)
    await act(() => appStore.getState().loadAppInfo())
    expect(await screen.findByText('StorageIQ 0.1.0')).toBeInTheDocument()
    expect(screen.queryByText(/files found/)).not.toBeInTheDocument()
  })

  it('shows free space, live files found, excluded count and the cluster size', async () => {
    const { api } = await renderBar()
    act(() => api.emitScanProgress(makeProgress({ files: 173_469, errorCount: 3 })))
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent('Free space: 400 GB of 1.0 TB')
    expect(footer).toHaveTextContent('173,469 files found')
    expect(footer).toHaveTextContent('3 excluded')
    expect(footer).toHaveTextContent('4,096 bytes per cluster (NTFS)')
  })

  it('opens the list of unreadable items from the excluded count', async () => {
    const user = userEvent.setup()
    const { api } = await renderBar()
    act(() => api.emitScanDone(makeDone()))
    await user.click(screen.getByRole('button', { name: '2 excluded' }))
    const dialog = screen.getByRole('dialog', { name: '2 folders couldn’t be read' })
    expect(within(dialog).getByText('D:\\System Volume Information')).toBeInTheDocument()
    expect(
      within(dialog).getByText('Windows didn’t give StorageIQ permission to open it.'),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says items when a file is among the unreadable entries', async () => {
    const user = userEvent.setup()
    const { api } = await renderBar()
    act(() =>
      api.emitScanDone(
        makeDone({
          errors: [
            { path: 'D:\\pagefile.sys', kind: 'file', reason: 'access-denied', code: 'EPERM' },
          ],
          errorCount: 1,
        }),
      ),
    )
    await user.click(screen.getByRole('button', { name: '1 excluded' }))
    expect(screen.getByRole('dialog', { name: '1 item couldn’t be read' })).toBeInTheDocument()
  })

  it('announces progress at most every 5 seconds', async () => {
    vi.useFakeTimers()
    const { api, container } = await renderBar()
    const live = container.querySelector('[aria-live="polite"]')
    act(() => api.emitScanProgress(makeProgress({ files: 999 })))
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(live).toHaveTextContent('999 files found so far.')
  })
})
