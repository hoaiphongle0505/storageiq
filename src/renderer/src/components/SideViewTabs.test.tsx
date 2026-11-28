// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useWorkspace } from '../stores/workspace-store-context'
import { renderWithStores } from '../test/render'
import { PANE_PANEL_ID, SideViewTabs } from './SideViewTabs'

const tabs = () => screen.getAllByRole('tab')

describe('<SideViewTabs />', () => {
  it('offers Treemap, Top files, Types and Age as tabs of one tab list', () => {
    renderWithStores(<SideViewTabs />)
    expect(screen.getByRole('tablist', { name: 'Pane views' })).toBeInTheDocument()
    expect(tabs().map((tab) => tab.textContent)).toEqual(['Treemap', 'Top files', 'Types', 'Age'])
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ])
    for (const tab of tabs()) expect(tab).toHaveAttribute('aria-controls', PANE_PANEL_ID)
  })

  it('is disabled until a scan exists, and then a click shows that view', async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(<SideViewTabs />)
    for (const tab of tabs()) expect(tab).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('tab', { name: 'Types' }))
    expect(workspace.getState().paneTab).toBe('treemap')

    await act(() => workspace.getState().startScan('D:\\'))
    for (const tab of tabs()) expect(tab).not.toHaveAttribute('aria-disabled')
    await user.click(screen.getByRole('tab', { name: 'Types' }))
    expect(workspace.getState().paneTab).toBe('types')
    expect(screen.getByRole('tab', { name: 'Types' })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the focus on the new tab when the view swap remounts the tab list', async () => {
    const user = userEvent.setup()
    function Remounting() {
      const paneTab = useWorkspace((s) => s.paneTab)
      return <SideViewTabs key={paneTab} />
    }
    const { workspace } = renderWithStores(<Remounting />)
    await act(() => workspace.getState().startScan('D:\\'))
    screen.getByRole('tab', { name: 'Treemap' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(workspace.getState().paneTab).toBe('top')
    expect(screen.getByRole('tab', { name: 'Top files' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Types' })).toHaveFocus()
  })

  it('moves between the tabs with the arrow keys, Home and End, and shows each view', async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(<SideViewTabs />)
    await act(() => workspace.getState().startScan('D:\\'))
    screen.getByRole('tab', { name: 'Treemap' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Top files' })).toHaveFocus()
    expect(workspace.getState().paneTab).toBe('top')
    await user.keyboard('{End}')
    expect(workspace.getState().paneTab).toBe('age')
    await user.keyboard('{ArrowRight}')
    expect(workspace.getState().paneTab).toBe('treemap')
    await user.keyboard('{ArrowLeft}')
    expect(workspace.getState().paneTab).toBe('age')
    await user.keyboard('{Home}')
    expect(workspace.getState().paneTab).toBe('treemap')
  })

  it('has one tab stop: only the selected tab is in the Tab order', async () => {
    const { workspace } = renderWithStores(<SideViewTabs />)
    await act(() => workspace.getState().startScan('D:\\'))
    act(() => workspace.getState().setPaneTab('types'))
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([-1, -1, 0, -1])
  })
})
