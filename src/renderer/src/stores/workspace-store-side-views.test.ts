import { describe, expect, it, vi } from 'vitest'
import { MAX_CLIPBOARD_TEXT } from '@shared/ipc-contract'
import { createFakeApi, TEST_AGE, TEST_TOP_FILES, TEST_TYPES } from '../test/fake-api'
import { CSV_TOO_LARGE_MESSAGE, createWorkspaceStore } from './workspace-store'

async function scanning(api = createFakeApi()) {
  const store = createWorkspaceStore(api)
  await store.getState().startScan('D:\\')
  return { api, store }
}

describe('the bottom pane tabs', () => {
  it('starts on the treemap, shown', () => {
    const store = createWorkspaceStore(createFakeApi())
    expect(store.getState()).toMatchObject({ paneTab: 'treemap', treemapVisible: true })
  })

  it('setPaneTab shows that view and the pane', () => {
    const store = createWorkspaceStore(createFakeApi())
    store.getState().setTreemapVisible(false)
    store.getState().setPaneTab('types')
    expect(store.getState()).toMatchObject({ paneTab: 'types', treemapVisible: true })
  })

  it('togglePane hides the pane when it already shows that view, else shows the view', () => {
    const store = createWorkspaceStore(createFakeApi())
    store.getState().togglePane('treemap')
    expect(store.getState().treemapVisible).toBe(false)
    store.getState().togglePane('top')
    expect(store.getState()).toMatchObject({ paneTab: 'top', treemapVisible: true })
    store.getState().togglePane('age')
    expect(store.getState()).toMatchObject({ paneTab: 'age', treemapVisible: true })
    store.getState().togglePane('age')
    expect(store.getState().treemapVisible).toBe(false)
  })
})

describe('the chart toggle', () => {
  it('starts shown and toggles for the Types and Age views together', () => {
    const store = createWorkspaceStore(createFakeApi())
    expect(store.getState().chartVisible).toBe(true)
    store.getState().toggleChart()
    expect(store.getState().chartVisible).toBe(false)
    store.getState().toggleChart()
    expect(store.getState().chartVisible).toBe(true)
  })
})

describe('fetching the side views', () => {
  it('asks for the treemap folder of the current scan, with the Mode for Top files', async () => {
    const { api, store } = await scanning()
    expect(await store.getState().fetchTopFiles()).toEqual(TEST_TOP_FILES)
    expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd0', 'size')
    store.getState().setMode('allocated')
    store.getState().select('d1')
    await store.getState().fetchTopFiles()
    expect(api.getTopFiles).toHaveBeenLastCalledWith('scan-1', 'd1', 'allocated')
    expect(await store.getState().fetchTypes()).toEqual(TEST_TYPES)
    expect(api.getTypeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd1')
    expect(await store.getState().fetchAges()).toEqual(TEST_AGE)
    expect(api.getAgeBreakdown).toHaveBeenLastCalledWith('scan-1', 'd1')
  })

  it('answers null before a scan and when the node is gone', async () => {
    const idle = createWorkspaceStore(createFakeApi())
    expect(await idle.getState().fetchTopFiles()).toBeNull()
    expect(await idle.getState().fetchTypes()).toBeNull()
    expect(await idle.getState().fetchAges()).toBeNull()

    const gone = await scanning(createFakeApi({ getTypeBreakdown: vi.fn(async () => null) }))
    expect(await gone.store.getState().fetchTypes()).toBeNull()
  })

  it('lets a failed call reject, so a view can tell "failed" from "gone"', async () => {
    const broken = await scanning(
      createFakeApi({
        getTopFiles: vi.fn(async () => {
          throw new Error('scanner busy')
        }),
      }),
    )
    await expect(broken.store.getState().fetchTopFiles()).rejects.toThrow('scanner busy')
  })

  it('loadTypeIcons asks for the keys, and answers empty for no keys or a failed call', async () => {
    const image = { small: 'data:image/png;base64,AA==', large: 'data:image/png;base64,BB==' }
    const api = createFakeApi({ getTypeIcons: vi.fn(async () => ({ 'ext:jpg': image })) })
    const store = createWorkspaceStore(api)
    expect(await store.getState().loadTypeIcons(['ext:jpg'])).toEqual({ 'ext:jpg': image })
    expect(api.getTypeIcons).toHaveBeenCalledWith(['ext:jpg'])
    expect(await store.getState().loadTypeIcons([])).toEqual({})
    expect(api.getTypeIcons).toHaveBeenCalledTimes(1)
    const failing = createWorkspaceStore(
      createFakeApi({
        getTypeIcons: vi.fn(async () => {
          throw new Error('no icons')
        }),
      }),
    )
    expect(await failing.getState().loadTypeIcons(['file'])).toEqual({})
  })
})

describe('copyCsv', () => {
  it('sends the text to main and announces the row count', async () => {
    const { api, store } = await scanning()
    await store.getState().copyCsv('Name\r\na\r\n', 1)
    expect(api.copyText).toHaveBeenCalledWith('Name\r\na\r\n')
    expect(store.getState().announcement).toBe('Copied 1 row.')
    await store.getState().copyCsv('Name\r\na\r\nb\r\n', 2)
    expect(store.getState().announcement).toBe('Copied 2 rows.')
  })

  it('refuses text over the limit without calling main', async () => {
    const { api, store } = await scanning()
    await store.getState().copyCsv('x'.repeat(MAX_CLIPBOARD_TEXT + 1), 5000)
    expect(api.copyText).not.toHaveBeenCalled()
    expect(store.getState().announcement).toBe(CSV_TOO_LARGE_MESSAGE)
  })

  it('shows the error banner when main refuses', async () => {
    const { store } = await scanning(
      createFakeApi({
        copyText: vi.fn(async () => {
          throw new Error("Error invoking remote method 'clipboard:copy-text': Error: no")
        }),
      }),
    )
    await store.getState().copyCsv('a', 1)
    expect(store.getState().banner).toMatchObject({ tone: 'error' })
  })
})
