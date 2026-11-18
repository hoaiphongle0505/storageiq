// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { StorageIQApi } from '@shared/ipc-contract'
import { App } from './App'
import { createAppStore } from './stores/app-store'
import { AppStoreProvider } from './stores/app-store-context'
import { createFakeApi, TEST_APP_INFO } from './test/fake-api'

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
    expect(screen.getAllByText('D:\\Photos')).toHaveLength(2)
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
})
