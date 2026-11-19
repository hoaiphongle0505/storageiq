// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeFailed } from '../test/scan-fixtures'
import { CrashScreen } from './CrashScreen'

async function renderCrash() {
  const api = createFakeApi()
  const utils = renderWithStores(<CrashScreen />, api)
  await act(() => utils.scanStore.getState().startScan('D:\\'))
  act(() => api.emitScanFailed(makeFailed()))
  return utils
}

describe('<CrashScreen />', () => {
  it('explains the crash and focuses Retry', async () => {
    await renderCrash()
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'The scan stopped unexpectedly. You can try again.',
      }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus()
  })

  it('Retry scans the same location again', async () => {
    const user = userEvent.setup()
    const { api } = await renderCrash()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.startScan).toHaveBeenCalledTimes(2)
    expect(api.startScan).toHaveBeenLastCalledWith('D:\\')
  })
})
