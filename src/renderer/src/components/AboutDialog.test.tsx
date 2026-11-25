// @vitest-environment jsdom
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AppInfo, UpdateState } from '@shared/ipc-contract'
import { createFakeApi, type FakeApi, TEST_APP_INFO } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { AboutDialog } from './AboutDialog'

async function renderAbout(options: { info?: AppInfo; api?: FakeApi } = {}) {
  const api =
    options.api ?? createFakeApi({ getAppInfo: vi.fn(async () => options.info ?? TEST_APP_INFO) })
  const onClose = vi.fn()
  const utils = renderWithStores(<AboutDialog onClose={onClose} />, api)
  await utils.appStore.getState().loadAppInfo()
  return { ...utils, api, onClose }
}

const status = () => screen.getByRole('status')
const dialog = () => screen.getByRole('dialog', { name: 'About StorageIQ' })
const show = (api: FakeApi, state: UpdateState) => act(() => api.emitUpdateState(state))

describe('<AboutDialog />', () => {
  it('shows the logo, name, version, channel and engine versions', async () => {
    await renderAbout()
    expect(dialog().querySelector('svg[viewBox="0 0 64 64"]')).toHaveAttribute('width', '64')
    expect(dialog()).toHaveTextContent('StorageIQ')
    expect(dialog()).toHaveTextContent('Version 0.1.0')
    expect(dialog()).toHaveTextContent('Stable')
    expect(dialog()).toHaveTextContent('Electron 45.3.4, Chromium 150.0.7000.0')
    expect(dialog()).toHaveTextContent(
      'Shows where your disk space went. Free and open source under the MIT license.',
    )
  })

  it('labels the channel Beta for a prerelease version and Stable otherwise', async () => {
    await renderAbout({ info: { ...TEST_APP_INFO, version: '0.2.0-beta.1', channel: 'Beta' } })
    expect(dialog()).toHaveTextContent('Version 0.2.0-beta.1')
    expect(dialog()).toHaveTextContent('Beta')
    expect(dialog()).not.toHaveTextContent('Stable')
  })

  it('idle offers Check for updates and clicking it calls checkForUpdates', async () => {
    const user = userEvent.setup()
    const { api } = await renderAbout()
    await user.click(within(status()).getByRole('button', { name: 'Check for updates' }))
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('checking is announced and the button is aria-disabled', async () => {
    const user = userEvent.setup()
    const { api } = await renderAbout()
    show(api, { kind: 'checking' })
    expect(status()).toHaveTextContent('Checking for updates…')
    const button = within(status()).getByRole('button', { name: 'Check for updates' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.click(button)
    expect(api.checkForUpdates).not.toHaveBeenCalled()
  })

  it('up-to-date, unavailable and error show their text', async () => {
    const { api } = await renderAbout()
    show(api, { kind: 'up-to-date' })
    expect(status()).toHaveTextContent('You have the latest version.')
    show(api, { kind: 'unavailable', message: 'Updates are available in the installed app.' })
    expect(status()).toHaveTextContent('Updates are available in the installed app.')
    show(api, { kind: 'error', message: 'Could not check for updates. Try again.' })
    expect(status()).toHaveTextContent('Could not check for updates. Try again.')
    expect(within(status()).getByRole('button', { name: 'Check for updates' })).toBeInTheDocument()
  })

  it("available offers Update and What's new", async () => {
    const user = userEvent.setup()
    const { api, workspace, onClose } = await renderAbout()
    show(api, { kind: 'available', version: '0.3.0' })
    expect(status()).toHaveTextContent('StorageIQ 0.3.0 is available.')
    await user.click(within(status()).getByRole('button', { name: 'Update' }))
    expect(api.downloadUpdate).toHaveBeenCalledTimes(1)
    await user.click(within(status()).getByRole('button', { name: "What's new" }))
    expect(onClose).toHaveBeenCalled()
    expect(workspace.getState().whatsNew).toEqual({ kind: 'update', version: '0.3.0' })
  })

  it('downloading shows progress and hides the buttons', async () => {
    const { api } = await renderAbout()
    show(api, { kind: 'downloading', version: '0.3.0', percent: 57 })
    expect(status()).toHaveTextContent('Downloading StorageIQ 0.3.0… 50%')
    expect(screen.getByRole('progressbar', { name: 'Update download' })).toHaveAttribute(
      'value',
      '57',
    )
    expect(within(status()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('ready offers Restart to update', async () => {
    const user = userEvent.setup()
    const { api } = await renderAbout()
    show(api, { kind: 'ready', version: '0.3.0' })
    expect(status()).toHaveTextContent('StorageIQ 0.3.0 is ready.')
    await user.click(within(status()).getByRole('button', { name: 'Restart to update' }))
    expect(api.installUpdate).toHaveBeenCalledTimes(1)
  })

  it("What's new closes About and opens the history target", async () => {
    const user = userEvent.setup()
    const { workspace, onClose } = await renderAbout()
    await user.click(screen.getByRole('button', { name: "What's new" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(workspace.getState().whatsNew).toEqual({ kind: 'history' })
  })

  it('links call openLink with repo and license', async () => {
    const user = userEvent.setup()
    const { api } = await renderAbout()
    await user.click(screen.getByRole('button', { name: 'GitHub repository' }))
    await user.click(screen.getByRole('button', { name: 'MIT licence' }))
    expect(api.openLink).toHaveBeenNthCalledWith(1, 'repo')
    expect(api.openLink).toHaveBeenNthCalledWith(2, 'license')
  })

  it('Third-party notices calls openNotices and reports a missing file', async () => {
    const user = userEvent.setup()
    const api = createFakeApi({ openNotices: vi.fn(async () => ({ opened: false })) })
    await renderAbout({ api })
    await user.click(screen.getByRole('button', { name: 'Third-party notices' }))
    expect(api.openNotices).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('The notices file was not found.')).toBeInTheDocument()
  })

  it('is a labelled modal dialog and Escape closes it', async () => {
    const { onClose } = await renderAbout()
    expect(dialog()).toBeInTheDocument()
    fireEvent(dialog(), new Event('cancel', { cancelable: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  })
})
