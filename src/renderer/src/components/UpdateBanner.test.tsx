// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { UpdateBanner } from './UpdateBanner'

const available = { kind: 'available' as const, version: '0.2.0' }

describe('<UpdateBanner />', () => {
  it("available shows the message with Update, What's new and Later", () => {
    const { api } = renderWithStores(<UpdateBanner />)
    act(() => api.emitUpdateState(available))
    expect(screen.getByRole('status')).toHaveTextContent('StorageIQ 0.2.0 is available.')
    for (const name of ['Update', "What's new", 'Later']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Update calls downloadUpdate', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<UpdateBanner />)
    act(() => api.emitUpdateState(available))
    await user.click(screen.getByRole('button', { name: 'Update' }))
    expect(api.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it("What's new opens the update target", async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(<UpdateBanner />)
    act(() => api.emitUpdateState(available))
    await user.click(screen.getByRole('button', { name: "What's new" }))
    expect(workspace.getState().whatsNew).toEqual({ kind: 'update', version: '0.2.0' })
  })

  it('Later hides the banner until a different version is available', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<UpdateBanner />)
    act(() => api.emitUpdateState(available))
    await user.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => api.emitUpdateState({ kind: 'available', version: '0.3.0' }))
    expect(screen.getByRole('status')).toHaveTextContent('StorageIQ 0.3.0 is available.')
  })

  it('downloading shows a labelled progress bar and no buttons', () => {
    const { api } = renderWithStores(<UpdateBanner />)
    act(() => api.emitUpdateState({ kind: 'downloading', version: '0.2.0', percent: 42 }))
    expect(screen.getByRole('status')).toHaveTextContent('Downloading StorageIQ 0.2.0… 40%')
    const bar = screen.getByRole('progressbar', { name: 'Update download' })
    expect(bar).toHaveAttribute('value', '42')
    expect(bar).toHaveAttribute('max', '100')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('ready shows Restart to update, which calls installUpdate', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<UpdateBanner />)
    act(() => api.emitUpdateState({ kind: 'ready', version: '0.2.0' }))
    expect(screen.getByRole('status')).toHaveTextContent(
      'StorageIQ 0.2.0 is ready. Restart to update.',
    )
    await user.click(screen.getByRole('button', { name: 'Restart to update' }))
    expect(api.installUpdate).toHaveBeenCalledTimes(1)
  })

  it('idle, checking, up-to-date and error render nothing', () => {
    const { api, container } = renderWithStores(<UpdateBanner />)
    expect(container).toBeEmptyDOMElement()
    for (const state of [
      { kind: 'checking' as const },
      { kind: 'up-to-date' as const },
      { kind: 'unavailable' as const, message: 'm' },
      { kind: 'error' as const, message: 'Could not check' },
    ]) {
      act(() => api.emitUpdateState(state))
      expect(container).toBeEmptyDOMElement()
    }
  })

  it('the progress text changes once per ten percent', () => {
    const { api } = renderWithStores(<UpdateBanner />)
    const text = (percent: number) => {
      act(() => api.emitUpdateState({ kind: 'downloading', version: '0.2.0', percent }))
      return screen.getByRole('status').textContent
    }
    expect(text(41)).toBe(text(49))
    expect(text(50)).not.toBe(text(49))
    expect(text(100)).toContain('100%')
  })

  it('focus stays where it was when the banner appears', () => {
    const api = createFakeApi()
    renderWithStores(
      <>
        <input aria-label="Filter" />
        <UpdateBanner />
      </>,
      api,
    )
    const input = screen.getByLabelText('Filter')
    input.focus()
    act(() => api.emitUpdateState(available))
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(document.activeElement).toBe(input)
  })
})
