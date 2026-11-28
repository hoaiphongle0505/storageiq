// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithStores } from '../test/render'
import { useSideView } from './use-side-view'

function Probe({
  fetch,
  extraKey = '',
}: {
  fetch: () => Promise<string[] | null>
  extraKey?: string
}) {
  const state = useSideView(fetch, extraKey)
  return <p data-testid="state">{state.status === 'ready' ? state.rows.join(',') : state.status}</p>
}

const shown = () => screen.getByTestId('state').textContent

describe('useSideView', () => {
  it('stays loading before a scan, then shows the rows of the answer', async () => {
    const fetch = vi.fn(async () => ['a', 'b'])
    const { workspace } = renderWithStores(<Probe fetch={fetch} />)
    expect(shown()).toBe('loading')
    expect(fetch).not.toHaveBeenCalled()
    await act(() => workspace.getState().startScan('D:\\'))
    await waitFor(() => expect(shown()).toBe('a,b'))
  })

  it('shows "gone" when the answer is null', async () => {
    const { workspace } = renderWithStores(<Probe fetch={async () => null} />)
    await act(() => workspace.getState().startScan('D:\\'))
    await waitFor(() => expect(shown()).toBe('gone'))
  })

  it('asks again when the folder or the tree revision changes', async () => {
    const fetch = vi.fn(async () => ['a'])
    const { workspace } = renderWithStores(<Probe fetch={fetch} />)
    await act(() => workspace.getState().startScan('D:\\'))
    await waitFor(() => expect(shown()).toBe('a'))
    const calls = fetch.mock.calls.length
    act(() => workspace.getState().select('d1'))
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(calls))
    const afterFolder = fetch.mock.calls.length
    act(() => workspace.setState({ revision: workspace.getState().revision + 1 }))
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(afterFolder))
  })

  it('keeps the previous rows while the next answer is on its way, and drops a stale answer', async () => {
    let release: (rows: string[]) => void = () => undefined
    const fetch = vi
      .fn<() => Promise<string[] | null>>()
      .mockResolvedValueOnce(['first'])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValue(['third'])
    const { workspace } = renderWithStores(<Probe fetch={fetch} />)
    await act(() => workspace.getState().startScan('D:\\'))
    await waitFor(() => expect(shown()).toBe('first'))
    act(() => workspace.getState().select('d1')) // the second answer is pending...
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(shown()).toBe('first')
    act(() => workspace.getState().select('d2')) // ...and a third one supersedes it
    await waitFor(() => expect(shown()).toBe('third'))
    await act(async () => release(['stale']))
    expect(shown()).toBe('third')
  })
})
