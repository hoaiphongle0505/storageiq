// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MAX_CLIPBOARD_TEXT } from '@shared/ipc-contract'
import { CSV_TOO_LARGE_MESSAGE } from '../stores/workspace-store'
import { renderWithStores } from '../test/render'
import { CopyCsvButton } from './CopyCsvButton'

const copyButton = () => screen.getByRole('button', { name: 'Copy as CSV' })

describe('<CopyCsvButton />', () => {
  it('builds the CSV when pressed, sends it through main and announces the row count', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(
      <CopyCsvButton build={() => 'Name\r\na\r\nb\r\n'} rows={2} />,
    )
    await act(() => workspace.getState().startScan('D:\\'))
    await user.click(copyButton())
    expect(api.copyText).toHaveBeenCalledWith('Name\r\na\r\nb\r\n')
    await waitFor(() => expect(workspace.getState().announcement).toBe('Copied 2 rows.'))
  })

  it('does nothing while the list is empty, and stays reachable', async () => {
    const user = userEvent.setup()
    const { api } = renderWithStores(<CopyCsvButton build={() => 'Name\r\n'} rows={0} />)
    expect(copyButton()).toHaveAttribute('aria-disabled', 'true')
    await user.click(copyButton())
    expect(api.copyText).not.toHaveBeenCalled()
  })

  it('says "Too many rows to copy." instead of sending more than the limit', async () => {
    const user = userEvent.setup()
    const { api, workspace } = renderWithStores(
      <CopyCsvButton build={() => 'x'.repeat(MAX_CLIPBOARD_TEXT + 1)} rows={5000} />,
    )
    await user.click(copyButton())
    expect(api.copyText).not.toHaveBeenCalled()
    expect(workspace.getState().announcement).toBe(CSV_TOO_LARGE_MESSAGE)
  })
})
