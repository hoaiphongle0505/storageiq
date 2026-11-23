// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { UpdateBanner } from './UpdateBanner'

describe('<UpdateBanner />', () => {
  it('renders nothing while no update is ready', () => {
    const { container } = renderWithStores(<UpdateBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the message with the version and a Restart button', () => {
    const { api } = renderWithStores(<UpdateBanner />)
    act(() => api.emitUpdateReady({ version: '0.2.0' }))
    const banner = screen.getByRole('status')
    expect(banner).toHaveTextContent('StorageIQ 0.2.0 is ready. Restart to update.')
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Restart calls installUpdate', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<UpdateBanner />)
    act(() => api.emitUpdateReady({ version: '0.2.0' }))
    await user.click(screen.getByRole('button', { name: 'Restart' }))
    expect(api.installUpdate).toHaveBeenCalledTimes(1)
  })

  it('Later hides the banner', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<UpdateBanner />)
    act(() => api.emitUpdateReady({ version: '0.2.0' }))
    expect(workspace.getState().updateReady).toEqual({ version: '0.2.0' })
    await user.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(workspace.getState().updateReady).toBeNull()
  })

  it('focus stays where it was when the banner appears', () => {
    const api = createFakeApi()
    const { workspace } = renderWithStores(
      <>
        <input aria-label="Filter" />
        <UpdateBanner />
      </>,
      api,
    )
    const input = screen.getByLabelText('Filter')
    input.focus()
    expect(document.activeElement).toBe(input)
    act(() => api.emitUpdateReady({ version: '0.2.0' }))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(document.activeElement).toBe(input)
    expect(workspace.getState().updateReady).not.toBeNull()
    vi.restoreAllMocks()
  })
})
