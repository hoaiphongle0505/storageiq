// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SelectFolderResult } from '@shared/ipc-contract'
import { DRIVES_ERROR, FOLDER_PICKER_ERROR } from '../stores/scan-store'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { PickLocationScreen } from './PickLocationScreen'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('<PickLocationScreen />', () => {
  it('shows one card per drive with its label, letter and free space', async () => {
    renderWithStores(<PickLocationScreen />)
    const fixed = await screen.findByRole('button', { name: /^Local Disk \(C:\)/ })
    const usb = screen.getByRole('button', { name: /^Photos \(E:\)/ })

    expect(
      screen.getByRole('heading', { level: 1, name: 'See what’s filling your disk' }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Drives' })).getAllByRole('button'),
    ).toHaveLength(2)
    expect(fixed).toHaveTextContent('128 GB free of 512 GB')
    expect(fixed).not.toHaveTextContent('USB')
    expect(usb).toHaveTextContent('USB')
    expect(usb).toHaveTextContent('16.0 GB free of 64.0 GB')
  })

  it('starts a scan of the drive the user clicks', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<PickLocationScreen />)
    await user.click(await screen.findByRole('button', { name: /^Photos \(E:\)/ }))
    expect(api.startScan).toHaveBeenCalledWith('E:\\')
  })

  it('scans the folder chosen with "Choose folder…"', async () => {
    const user = userEvent.setup()
    const api = createFakeApi({
      selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Projects' }),
    })
    renderWithStores(<PickLocationScreen />, api)
    await user.click(screen.getByRole('button', { name: 'Choose folder…' }))
    await waitFor(() => expect(api.startScan).toHaveBeenCalledWith('D:\\Projects'))
  })

  it('explains when the drives cannot be listed and still offers a folder', async () => {
    renderWithStores(
      <PickLocationScreen />,
      createFakeApi({ listDrives: vi.fn().mockRejectedValue(new Error('koffi')) }),
    )
    expect(await screen.findByText(DRIVES_ERROR)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose folder…' })).toBeInTheDocument()
  })

  it('keeps "Choose folder…" focusable but inert while the picker is open', async () => {
    const user = userEvent.setup()
    const pending = deferred<SelectFolderResult>()
    const api = createFakeApi({ selectFolder: vi.fn(() => pending.promise) })
    renderWithStores(<PickLocationScreen />, api)

    const button = screen.getByRole('button', { name: 'Choose folder…' })
    await user.click(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveFocus()
    await user.click(button)
    expect(api.selectFolder).toHaveBeenCalledTimes(1)

    pending.resolve({ canceled: true })
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'))
  })

  it('shows a dismissible error when the folder picker fails, then refocuses the button', async () => {
    const user = userEvent.setup()
    renderWithStores(
      <PickLocationScreen />,
      createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('IPC down')) }),
    )
    await user.click(screen.getByRole('button', { name: 'Choose folder…' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(FOLDER_PICKER_ERROR)

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose folder…' })).toHaveFocus()
  })
})
