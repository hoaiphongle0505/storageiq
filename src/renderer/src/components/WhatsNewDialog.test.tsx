// @vitest-environment jsdom
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeApi, type FakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import type { WhatsNewTarget } from '../stores/workspace-store'
import { WhatsNewDialog } from './WhatsNewDialog'

async function renderDialog(target: WhatsNewTarget, api: FakeApi = createFakeApi()) {
  const utils = renderWithStores(<WhatsNewDialog target={target} />, api)
  await act(async () => {
    await Promise.resolve()
  })
  return { ...utils, api }
}

const dialog = () => screen.getByRole('dialog', { name: "What's new" })

describe('<WhatsNewDialog />', () => {
  it('shows Loading… in a polite status first', () => {
    renderWithStores(<WhatsNewDialog target={{ kind: 'history' }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  })

  it('history lists entries newest first with date and sections', async () => {
    await renderDialog({ kind: 'history' })
    const headings = within(dialog())
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent)
    expect(headings).toEqual(['Version 0.2.0-beta.1 (2026-11-25)', 'Version 0.1.0'])
    expect(
      within(dialog())
        .getAllByRole('heading', { level: 4 })
        .map((h) => h.textContent),
    ).toEqual(['Added', 'Fixed', 'Added'])
    expect(within(dialog()).getAllByRole('listitem')).toHaveLength(4)
  })

  it('installed shows only the matching entry', async () => {
    await renderDialog({ kind: 'installed', version: '0.1.0' })
    expect(within(dialog()).getAllByRole('heading', { level: 3 })).toHaveLength(1)
    expect(dialog()).toHaveTextContent('Version 0.1.0')
    expect(dialog()).toHaveTextContent('First release.')
  })

  it('installed without an entry shows the message and the release page button', async () => {
    const user = userEvent.setup()
    const { api } = await renderDialog({ kind: 'installed', version: '9.9.9' })
    expect(dialog()).toHaveTextContent('No release notes are bundled with this version.')
    await user.click(screen.getByRole('button', { name: 'View release page' }))
    expect(api.openLink).toHaveBeenCalledWith('releases')
  })

  it('update shows the release notes as plain text and does not parse HTML', async () => {
    const text = 'Fixes <img src=x onerror=alert(1)> and more\n- item'
    const api = createFakeApi({ getReleaseNotes: vi.fn(async () => ({ version: '0.3.0', text })) })
    await renderDialog({ kind: 'update', version: '0.3.0' }, api)
    expect(dialog().querySelector('img')).toBeNull()
    const notes = dialog().querySelector('.whitespace-pre-wrap')
    expect(notes?.textContent).toBe(text)
  })

  it('update with null text falls back to the release page button', async () => {
    const api = createFakeApi({ getReleaseNotes: vi.fn(async () => null) })
    await renderDialog({ kind: 'update', version: '0.3.0' }, api)
    expect(dialog()).toHaveTextContent('Release notes are on the release page.')
    expect(screen.getByRole('button', { name: 'View release page' })).toBeInTheDocument()
  })

  it('a failing getReleaseNotes falls back to the release page button', async () => {
    const api = createFakeApi({ getReleaseNotes: vi.fn().mockRejectedValue(new Error('x')) })
    await renderDialog({ kind: 'update', version: '0.3.0' }, api)
    expect(dialog()).toHaveTextContent('Release notes are on the release page.')
    expect(screen.getByRole('button', { name: 'View release page' })).toBeInTheDocument()
  })

  it('Escape closes it', async () => {
    const { workspace } = await renderDialog({ kind: 'history' })
    act(() => workspace.getState().openWhatsNew({ kind: 'history' }))
    fireEvent(dialog(), new Event('cancel', { cancelable: true }))
    expect(workspace.getState().whatsNew).toBeNull()
  })
})
