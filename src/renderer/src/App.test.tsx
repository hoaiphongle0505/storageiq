// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SelectFolderResult, StorageIQApi } from '@shared/ipc-contract'
import { App } from './App'
import { createAppStore } from './stores/app-store'
import { AppStoreProvider } from './stores/app-store-context'
import { createFakeApi, TEST_APP_INFO } from './test/fake-api'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function renderApp(api: StorageIQApi = createFakeApi()) {
  const store = createAppStore(api)
  render(
    <AppStoreProvider store={store}>
      <App />
    </AppStoreProvider>,
  )
  return store
}

describe('<App />', () => {
  it('greets the user and shows the version from the main process', async () => {
    renderApp()
    expect(
      screen.getByRole('heading', { level: 1, name: 'See what’s filling your disk' }),
    ).toBeInTheDocument()
    expect(screen.getByText('No folder selected')).toBeInTheDocument()
    expect(await screen.findByText(`StorageIQ ${TEST_APP_INFO.version}`)).toBeInTheDocument()
  })

  it('shows the chosen folder after the user picks one', async () => {
    const user = userEvent.setup()
    renderApp(
      createFakeApi({
        selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Photos' }),
      }),
    )

    await user.click(screen.getByRole('button', { name: 'Choose folder' }))

    expect(await screen.findByText('Selected folder')).toBeInTheDocument()
    expect(within(screen.getByRole('contentinfo')).getByText('D:\\Photos')).toBeInTheDocument()
    expect(
      within(screen.getByText('Selected folder').parentElement as HTMLElement).getByText(
        'D:\\Photos',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose a different folder' })).toBeInTheDocument()
  })

  it('shows a dismissible error when the folder picker fails', async () => {
    const user = userEvent.setup()
    renderApp(createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('IPC down')) }))

    await user.click(screen.getByRole('button', { name: 'Choose folder' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('StorageIQ couldn’t open the folder picker. Please try again.')

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps keyboard focus on the button while the folder picker is open', async () => {
    const user = userEvent.setup()
    const pending = deferred<SelectFolderResult>()
    renderApp(createFakeApi({ selectFolder: vi.fn(() => pending.promise) }))

    const button = screen.getByRole('button', { name: 'Choose folder' })
    await user.click(button)

    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(button).toHaveFocus()
    pending.resolve({ canceled: true })
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled', 'true'))
  })

  it('returns focus to the Choose folder button after the error is dismissed', async () => {
    const user = userEvent.setup()
    renderApp(createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('IPC down')) }))

    await user.click(screen.getByRole('button', { name: 'Choose folder' }))
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(screen.getByRole('button', { name: 'Choose folder' })).toHaveFocus()
  })
})
