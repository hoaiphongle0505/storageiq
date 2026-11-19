// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeProgress } from '../test/scan-fixtures'
import { ScanningScreen } from './ScanningScreen'

async function renderScanning() {
  const utils = renderWithStores(<ScanningScreen />, createFakeApi())
  await act(() => utils.scanStore.getState().startScan('D:\\'))
  return utils
}

function stat(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling
}

afterEach(() => {
  vi.useRealTimers()
})

describe('<ScanningScreen />', () => {
  it('focuses Cancel and shows what has been found so far', async () => {
    const { api } = await renderScanning()
    act(() => api.emitScanProgress(makeProgress()))

    expect(screen.getByRole('heading', { level: 1, name: 'Scanning' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(stat('Files found')).toHaveTextContent('420')
    expect(stat('Folders found')).toHaveTextContent('17')
    expect(stat('Size found')).toHaveTextContent('5.0 MB')
    expect(stat('Elapsed')).toHaveTextContent('1.5 s')
    expect(screen.getByText('D:\\Photos\\2024\\Summer')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Largest folders so far' })).toHaveTextContent(
      'Photos',
    )
  })

  it('middle-truncates a long current path and keeps the full path as a tooltip', async () => {
    const { api } = await renderScanning()
    const longPath = `D:\\${'Very Long Folder Name\\'.repeat(6)}photo.jpg`
    act(() => api.emitScanProgress(makeProgress({ currentPath: longPath })))

    const shown = screen.getByTitle(longPath)
    expect(shown.textContent).toHaveLength(80)
    expect(shown.textContent).toContain('…')
    expect(shown.textContent?.endsWith('photo.jpg')).toBe(true)
  })

  it('asks main to cancel when Cancel is pressed', async () => {
    const user = userEvent.setup()
    const { api } = await renderScanning()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.cancelScan).toHaveBeenCalledWith('scan-1')
  })

  it('announces progress to screen readers at most every 5 seconds', async () => {
    vi.useFakeTimers()
    const { api, container } = await renderScanning()
    const live = container.querySelector('[aria-live="polite"]')
    expect(live).toHaveTextContent('Scan started.')

    act(() => api.emitScanProgress(makeProgress()))
    expect(live).toHaveTextContent('Scan started.')
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(live).toHaveTextContent('420 files and 17 folders found, 5.0 MB so far.')

    act(() => api.emitScanProgress(makeProgress({ files: 999 })))
    act(() => {
      vi.advanceTimersByTime(4_999)
    })
    expect(live).toHaveTextContent('420 files')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(live).toHaveTextContent('999 files')
  })
})
