// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeApi, fakeTreemap } from '../test/fake-api'
import { renderWithStores } from '../test/render'
import { LevelBar } from './LevelBar'
import { TreemapPane } from './TreemapPane'

class FixedSizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, contentRect: { width: 400, height: 200 } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }
  unobserve() {}
  disconnect() {}
}

const fakeContext = {
  setTransform: vi.fn(),
  clearRect: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  clip: vi.fn(),
  rect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textBaseline: 'alphabetic',
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FixedSizeObserver)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeContext as unknown as CanvasRenderingContext2D,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, 400, 200),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function renderPane(api = createFakeApi()) {
  const utils = renderWithStores(<TreemapPane height={260} />, api)
  await act(() => utils.workspace.getState().startScan('D:\\'))
  const canvas = await screen.findByRole('img')
  return { ...utils, canvas }
}

describe('<TreemapPane />', () => {
  it('asks the scanner for a layout of the selected folder at the canvas size and draws it', async () => {
    const { api, canvas } = await renderPane()
    await waitFor(() =>
      expect(api.getTreemap).toHaveBeenCalledWith('scan-1', 'd0', 'size', 1, 400, 200),
    )
    expect(canvas).toHaveAccessibleName(/The folder tree lists the same items\.$/)
    await waitFor(() => expect(fakeContext.fillRect).toHaveBeenCalled())
  })

  it('a click selects the block’s row in the tree; a double-click drills in', async () => {
    const { workspace, canvas } = await renderPane()
    fireEvent.click(canvas, { clientX: 300, clientY: 50 })
    await waitFor(() => expect(workspace.getState().selectedId).toBe('d2'))
    expect(workspace.getState().treemapRootId).toBe('d0')
    fireEvent.doubleClick(canvas, { clientX: 50, clientY: 50 })
    await waitFor(() => expect(workspace.getState().treemapRootId).toBe('d1'))
    expect(workspace.getState().selectedId).toBe('d1')
  })

  it('lays out again when the tree selection, the Mode or the level changes', async () => {
    const { api, workspace } = await renderPane()
    act(() => workspace.getState().select('d1'))
    await waitFor(() =>
      expect(api.getTreemap).toHaveBeenLastCalledWith('scan-1', 'd1', 'size', 1, 400, 200),
    )
    act(() => workspace.getState().setMode('allocated'))
    act(() => workspace.getState().setTreemapDepth(3))
    await waitFor(() =>
      expect(api.getTreemap).toHaveBeenLastCalledWith('scan-1', 'd1', 'allocated', 3, 400, 200),
    )
  })

  it('never draws the previous layout with the new Mode’s labels', async () => {
    const { api, workspace } = await renderPane()
    await waitFor(() => expect(fakeContext.fillText).toHaveBeenCalled())
    let release: () => void = () => undefined
    vi.mocked(api.getTreemap).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(fakeTreemap('d0', 400, 200))
        }),
    )
    fakeContext.fillText.mockClear()
    act(() => workspace.getState().setMode('files'))
    await waitFor(() =>
      expect(api.getTreemap).toHaveBeenLastCalledWith('scan-1', 'd0', 'files', 1, 400, 200),
    )
    expect(fakeContext.fillText.mock.calls.some(([text]) => String(text).includes(' files)'))).toBe(
      false,
    )
    await act(async () => release())
    await waitFor(() =>
      expect(
        fakeContext.fillText.mock.calls.some(([text]) => String(text).includes(' files)')),
      ).toBe(true),
    )
  })

  it('shows an error state when the scanner cannot lay the folder out', async () => {
    const { api, workspace } = await renderPane()
    vi.mocked(api.getTreemap).mockRejectedValueOnce(new Error('scanner busy'))
    act(() => workspace.getState().setTreemapDepth(2))
    expect(await screen.findByRole('status')).toHaveTextContent('couldn’t be drawn')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('ignores clicks on a layout that belongs to another folder', async () => {
    const { api, workspace, canvas } = await renderPane()
    vi.mocked(api.getTreemap).mockImplementationOnce(() => new Promise(() => undefined))
    act(() => workspace.getState().select('d1'))
    await waitFor(() =>
      expect(api.getTreemap).toHaveBeenLastCalledWith('scan-1', 'd1', 'size', 1, 400, 200),
    )
    fireEvent.click(canvas, { clientX: 300, clientY: 50 })
    fireEvent.doubleClick(canvas, { clientX: 50, clientY: 50 })
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(workspace.getState().selectedId).toBe('d1')
    expect(workspace.getState().treemapRootId).toBe('d1')
  })

  it('hides with the close button', async () => {
    const user = userEvent.setup()
    const { workspace } = await renderPane()
    await user.click(screen.getByRole('button', { name: 'Hide treemap' }))
    expect(workspace.getState().treemapVisible).toBe(false)
  })
})

describe('<LevelBar />', () => {
  it('offers Level 0 to Level 5 as toggles and sets the depth', async () => {
    const user = userEvent.setup()
    const { workspace } = renderWithStores(<LevelBar />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Level 0',
      'Level 1',
      'Level 2',
      'Level 3',
      'Level 4',
      'Level 5',
    ])
    expect(screen.getByRole('button', { name: 'Level 1' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Level 5' }))
    expect(workspace.getState().treemapDepth).toBe(5)
    screen.getByRole('button', { name: 'Level 5' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: 'Level 0' })).toHaveFocus()
  })
})
