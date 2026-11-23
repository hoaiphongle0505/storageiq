// @vitest-environment jsdom
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createFakeApi, TEST_PLACES } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { SelectMenu } from './SelectMenu'

async function openMenu(api = createFakeApi()) {
  const user = userEvent.setup()
  const utils = renderWithStores(<SelectMenu />, api)
  await user.click(screen.getByRole('button', { name: /^Select/ }))
  const menu = await screen.findByRole('menu', { name: 'Select a drive or folder' })
  await within(menu).findByRole('menuitem', { name: 'Local Disk (C:)' })
  return { ...utils, user, menu }
}

describe('<SelectMenu />', () => {
  it('lists drives, Documents and cloud, recent scans and the folder picker in groups', async () => {
    const { menu } = await openMenu()
    const groups = within(menu).getAllByRole('group')
    expect(groups.map((group) => group.getAttribute('aria-labelledby') !== null)).toEqual([
      true,
      true,
      true,
      true,
    ])
    expect(within(menu).getByRole('group', { name: 'Drives' })).toHaveTextContent(
      'Local Disk (C:)Photos (E:)',
    )
    expect(within(menu).getByRole('group', { name: 'Documents and cloud' })).toHaveTextContent(
      'DocumentsOneDrive',
    )
    const recent = within(menu).getByRole('group', { name: 'Recently scanned' })
    expect(within(recent).getByRole('menuitem', { name: '(none)' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(menu).getByRole('menuitem', { name: 'Choose a folder…' })).toBeInTheDocument()
  })

  it('keeps focus on the trigger after a pointer open', async () => {
    await openMenu()
    expect(screen.getByRole('button', { name: /^Select/ })).toHaveFocus()
    expect(screen.getByRole('button', { name: /^Select/ })).toHaveAttribute('aria-expanded', 'true')
  })

  it('scans a drive, a place or a recent path', async () => {
    const api = createFakeApi({
      listPlaces: vi.fn(async () => ({ ...TEST_PLACES, recent: ['D:\\Old scan'] })),
    })
    const { user } = await openMenu(api)
    await user.click(screen.getByRole('menuitem', { name: 'Photos (E:)' }))
    expect(api.startScan).toHaveBeenCalledWith('E:\\')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Select/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'OneDrive' }))
    expect(api.startScan).toHaveBeenLastCalledWith('C:\\Users\\Ana\\OneDrive')

    await user.click(screen.getByRole('button', { name: /^Select/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'D:\\Old scan' }))
    expect(api.startScan).toHaveBeenLastCalledWith('D:\\Old scan')
  })

  it('opens the folder picker from "Choose a folder…"', async () => {
    const api = createFakeApi({
      selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Projects' }),
    })
    const { user } = await openMenu(api)
    await user.click(screen.getByRole('menuitem', { name: 'Choose a folder…' }))
    await waitFor(() => expect(api.startScan).toHaveBeenCalledWith('D:\\Projects'))
  })

  it('opens from the keyboard into the first item, moves with arrows and closes with Escape', async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(<SelectMenu />)
    await act(() => workspace.getState().loadMenuData()) // the app loads it at startup
    const trigger = screen.getByRole('button', { name: /^Select/ })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    const first = await screen.findByRole('menuitem', { name: 'Local Disk (C:)' })
    await waitFor(() => expect(first).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Photos (E:)' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: 'Choose a folder…' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('after a pointer open, ArrowDown enters the menu and Escape closes it', async () => {
    const { user } = await openMenu()
    const trigger = screen.getByRole('button', { name: /^Select/ })
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Local Disk (C:)' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('Tab inside the open menu closes it and continues from the trigger', async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(
      <>
        <button type="button">Before the menu</button>
        <SelectMenu />
        <button type="button">After the menu</button>
      </>,
    )
    await act(() => workspace.getState().loadMenuData())
    const trigger = screen.getByRole('button', { name: /^Select/ })
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Local Disk (C:)' })).toHaveFocus(),
    )
    await user.tab()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'After the menu' })).toHaveFocus()

    // Shift+Tab leaves from the trigger too, so focus never falls back to the page body.
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Local Disk (C:)' })).toHaveFocus(),
    )
    await user.tab({ shift: true })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Before the menu' })).toHaveFocus()
  })

  it('closes on an outside click', async () => {
    const { user } = await openMenu()
    await user.click(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
