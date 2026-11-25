// @vitest-environment jsdom
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { OptionsChangeResult, OptionsState } from '@shared/ipc-contract'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { OptionsGroup } from './OptionsGroup'

const OFF: OptionsState = {
  available: true,
  explorerMenu: false,
  runAsAdmin: false,
  runAsAdminLocked: false,
}
const UNAVAILABLE: OptionsState = { ...OFF, available: false }

const MENU = 'Show StorageIQ in Explorer’s context menu'
const ADMIN = 'Always start StorageIQ as administrator'
const CALM = 'Windows did not allow that change. Your settings are unchanged.'

function renderOptions(state: OptionsState = OFF, overrides = {}) {
  const api = createFakeApi({ getOptionsState: vi.fn(async () => state), ...overrides })
  return { ...renderWithStores(<OptionsGroup />, api), api }
}

const menuBox = () => screen.getByRole('checkbox', { name: MENU })
const adminBox = () => screen.getByRole('checkbox', { name: ADMIN })

describe('<OptionsGroup />', () => {
  it('renders the Application group with two checkboxes', async () => {
    renderOptions()
    expect(screen.getByRole('group', { name: 'Application' })).toBeInTheDocument()
    await waitFor(() => expect(menuBox()).toBeEnabled())
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })

  it('both are disabled with “Available in the installed app” when unavailable', async () => {
    renderOptions(UNAVAILABLE)
    const caption = await screen.findByText('Available in the installed app')
    expect(menuBox()).toBeDisabled()
    expect(adminBox()).toBeDisabled()
    expect(menuBox().getAttribute('aria-describedby')).toContain(caption.id)
    expect(adminBox().getAttribute('aria-describedby')).toContain(caption.id)
  })

  it('reflects the system state (checked and unchecked)', async () => {
    renderOptions({ ...OFF, explorerMenu: true })
    await waitFor(() => expect(menuBox()).toBeChecked())
    expect(adminBox()).not.toBeChecked()
  })

  it('shows the explanations as visible text that describes each box', async () => {
    renderOptions()
    await waitFor(() => expect(menuBox()).toBeEnabled())
    const menuNote = screen.getByText('Adds “Scan with StorageIQ” to right-click menus')
    const adminNote = screen.getByText(
      /^Windows asks for approval each time StorageIQ starts\. While it runs as administrator, Explorer menu commands run as administrator too/,
    )
    expect(adminNote.textContent).toContain('Delete asks for no permission')
    expect(adminNote.textContent).toContain('Open runs a program as administrator')
    expect(menuBox().getAttribute('aria-describedby')).toContain(menuNote.id)
    expect(adminBox().getAttribute('aria-describedby')).toContain(adminNote.id)
  })

  it('shows a visible note and disabled boxes when the registry cannot be read', async () => {
    renderOptions({ ...UNAVAILABLE, readFailed: true })
    const note = await screen.findByText('Could not read this setting')
    expect(menuBox()).toBeDisabled()
    expect(adminBox()).toBeDisabled()
    expect(menuBox()).not.toBeChecked()
    expect(menuBox().getAttribute('aria-describedby')).toContain(note.id)
    expect(screen.queryByText('Available in the installed app')).toBeNull()
  })

  it('shows the same note when the state call itself rejects', async () => {
    renderOptions(OFF, { getOptionsState: vi.fn().mockRejectedValue(new Error('ipc')) })
    expect(await screen.findByText('Could not read this setting')).toBeVisible()
    expect(menuBox()).toBeDisabled()
  })

  it('toggling calls the setter with a boolean and applies the returned state', async () => {
    const user = userEvent.setup()
    const result: OptionsChangeResult = { state: { ...OFF, explorerMenu: true }, error: null }
    const setExplorerMenu = vi.fn(async () => result)
    renderOptions(OFF, { setExplorerMenu })
    await waitFor(() => expect(menuBox()).toBeEnabled())
    await user.click(menuBox())
    expect(setExplorerMenu).toHaveBeenCalledWith(true)
    await waitFor(() => expect(menuBox()).toBeChecked())
    expect(adminBox()).not.toBeChecked()
  })

  it('shows the restart line after changing the administrator option', async () => {
    const user = userEvent.setup()
    const setRunAsAdmin = vi.fn(async () => ({ state: { ...OFF, runAsAdmin: true }, error: null }))
    renderOptions(OFF, { setRunAsAdmin })
    await waitFor(() => expect(adminBox()).toBeEnabled())
    await user.click(adminBox())
    expect(setRunAsAdmin).toHaveBeenCalledWith(true)
    expect(await screen.findByText('Takes effect the next time StorageIQ starts')).toBeVisible()
    await waitFor(() => expect(adminBox()).toBeChecked())
  })

  it('does not show the restart line before a change', async () => {
    renderOptions()
    await waitFor(() => expect(adminBox()).toBeEnabled())
    expect(screen.queryByText('Takes effect the next time StorageIQ starts')).toBeNull()
  })

  it('shows the calm error and keeps the real state when the change fails', async () => {
    const user = userEvent.setup()
    const setExplorerMenu = vi.fn(async () => ({ state: OFF, error: CALM }))
    renderOptions(OFF, { setExplorerMenu })
    await waitFor(() => expect(menuBox()).toBeEnabled())
    await user.click(menuBox())
    expect(await screen.findByRole('status')).toHaveTextContent(CALM)
    expect(menuBox()).not.toBeChecked()
    expect(screen.queryByText('Takes effect the next time StorageIQ starts')).toBeNull()
  })

  it('shows the calm error when the call itself rejects', async () => {
    const user = userEvent.setup()
    renderOptions(OFF, { setRunAsAdmin: vi.fn().mockRejectedValue(new Error('ipc')) })
    await waitFor(() => expect(adminBox()).toBeEnabled())
    await user.click(adminBox())
    expect(await screen.findByRole('status')).toHaveTextContent(CALM)
    expect(adminBox()).not.toBeChecked()
  })

  it('disables both boxes while a change is in flight', async () => {
    const user = userEvent.setup()
    let finish!: (value: OptionsChangeResult) => void
    const pending = new Promise<OptionsChangeResult>((resolve) => {
      finish = resolve
    })
    renderOptions(OFF, { setExplorerMenu: vi.fn(() => pending) })
    await waitFor(() => expect(menuBox()).toBeEnabled())
    await user.click(menuBox())
    expect(menuBox()).toBeDisabled()
    expect(adminBox()).toBeDisabled()
    finish({ state: { ...OFF, explorerMenu: true }, error: null })
    await waitFor(() => expect(menuBox()).toBeEnabled())
    expect(menuBox()).toBeChecked()
  })

  it('shows the administrator box checked and disabled when locked', async () => {
    renderOptions({ ...OFF, runAsAdmin: true, runAsAdminLocked: true })
    await waitFor(() => expect(adminBox()).toBeChecked())
    expect(adminBox()).toBeDisabled()
    const reason = screen.getByText('Set for all users by your administrator')
    expect(reason).toBeVisible()
    expect(adminBox().getAttribute('aria-describedby')).toContain(reason.id)
    expect(menuBox()).toBeEnabled()
  })

  it('every checkbox has an accessible name', async () => {
    renderOptions()
    await waitFor(() => expect(menuBox()).toBeEnabled())
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toHaveAccessibleName(/\S/)
    }
  })
})
