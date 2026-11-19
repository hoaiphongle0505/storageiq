// @vitest-environment jsdom
import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ScanDone } from '@shared/scan-types'
import { createFakeApi } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { makeDone } from '../test/scan-fixtures'
import { ResultScreen } from './ResultScreen'

async function renderResult(overrides: Partial<ScanDone> = {}) {
  const api = createFakeApi()
  const utils = renderWithStores(<ResultScreen />, api)
  await act(() => utils.scanStore.getState().startScan('D:\\'))
  act(() => api.emitScanDone(makeDone(overrides)))
  return utils
}

function stat(label: string) {
  return screen.getByText(label, { selector: 'dt' }).nextElementSibling
}

describe('<ResultScreen />', () => {
  it('summarises a complete scan and moves focus to its heading', async () => {
    await renderResult()
    const heading = screen.getByRole('heading', { level: 1, name: 'Scan complete' })
    expect(heading).toHaveFocus()
    expect(screen.getByText('D:\\')).toBeInTheDocument()
    expect(stat('Total size')).toHaveTextContent('3.0 GB')
    expect(stat('Total size')).toHaveAttribute('title', '3,221,225,472 bytes')
    expect(stat('Files')).toHaveTextContent('1,234')
    expect(stat('Folders')).toHaveTextContent('56')
    expect(stat('Scan time')).toHaveTextContent('12 s')
  })

  it('lists the largest folders with their share of the total', async () => {
    await renderResult()
    const items = screen.getByRole('region', { name: 'Largest folders' }).querySelectorAll('li')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('Videos')
    expect(items[0]).toHaveTextContent('2.0 GB')
    expect(items[0]).toHaveTextContent('67%')
    expect(items[2]).toHaveTextContent('Everything else')
    expect(items[2]).toHaveTextContent('256 MB')
    expect(items[2]).toHaveTextContent('8%')
  })

  it('lists folders that could not be read, with plain-language reasons', async () => {
    await renderResult()
    expect(screen.getByText('2 folders couldn’t be read')).toBeInTheDocument()
    expect(screen.getByText('D:\\System Volume Information')).toBeInTheDocument()
    expect(
      screen.getByText('Windows didn’t give StorageIQ permission to open it.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Its path is too long for Windows to open.')).toBeInTheDocument()
  })

  it('uses singular wording for one unreadable folder', async () => {
    await renderResult({
      errors: [{ path: 'D:\\Locked', reason: 'other', code: 'EBUSY' }],
      errorCount: 1,
    })
    expect(screen.getByText('1 folder couldn’t be read')).toBeInTheDocument()
    expect(screen.getByText('Windows reported an error (EBUSY).')).toBeInTheDocument()
  })

  it('shows no list when every folder was read', async () => {
    await renderResult({ errors: [], errorCount: 0 })
    expect(screen.queryByText(/couldn’t be read/)).not.toBeInTheDocument()
  })

  it('says when only the first unreadable folders are listed', async () => {
    await renderResult({ errorCount: 1500 })
    expect(screen.getByText('1,500 folders couldn’t be read')).toBeInTheDocument()
    expect(screen.getByText('Showing the first 2.')).toBeInTheDocument()
  })

  it('labels a canceled scan as partial results', async () => {
    await renderResult({ status: 'canceled' })
    expect(
      screen.getByRole('heading', { level: 1, name: 'Scan canceled — partial results' }),
    ).toBeInTheDocument()
  })

  it('"Scan again" scans the same location', async () => {
    const user = userEvent.setup()
    const { api } = await renderResult()
    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    expect(api.startScan).toHaveBeenCalledTimes(2)
    expect(api.startScan).toHaveBeenLastCalledWith('D:\\')
  })

  it('"Choose another location" goes back to the start', async () => {
    const user = userEvent.setup()
    const { scanStore } = await renderResult()
    await user.click(screen.getByRole('button', { name: 'Choose another location' }))
    expect(scanStore.getState().phase).toBe('idle')
  })
})
