// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import { TEST_APP_INFO } from './test/fake-api'
import { renderWithStores } from './test/render'
import { makeDone, makeFailed, makeProgress } from './test/scan-fixtures'

describe('<App />', () => {
  it('opens on the pick-location screen and shows the version from main', async () => {
    renderWithStores(<App />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'See what’s filling your disk' }),
    ).toBeInTheDocument()
    expect(screen.getByText('No folder selected')).toBeInTheDocument()
    expect(await screen.findByText(`StorageIQ ${TEST_APP_INFO.version}`)).toBeInTheDocument()
  })

  it('goes from a drive to the scanning screen to the result', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<App />)

    await user.click(await screen.findByRole('button', { name: /^Local Disk \(C:\)/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Scanning' })).toBeInTheDocument()

    act(() => api.emitScanProgress(makeProgress()))
    act(() => api.emitScanDone(makeDone()))

    expect(screen.getByRole('heading', { level: 1, name: 'Scan complete' })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toHaveTextContent('C:\\')
  })

  it('shows the crash screen when the scanner fails, and Retry scans again', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<App />)

    await user.click(await screen.findByRole('button', { name: /^Local Disk \(C:\)/ }))
    await screen.findByRole('heading', { level: 1, name: 'Scanning' })
    act(() => api.emitScanFailed(makeFailed()))

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'The scan stopped unexpectedly. You can try again.',
      }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.startScan).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('heading', { level: 1, name: 'Scanning' })).toBeInTheDocument()
  })
})
