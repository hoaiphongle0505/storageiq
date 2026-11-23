import { describe, expect, it, vi } from 'vitest'
import type { ScanStartResult } from '@shared/scan-types'
import { createFakeApi, TEST_DRIVE_DETAILS, TEST_DRIVES, TEST_PLACES } from '../test/fake-api'
import { makeDone, makeFailed, makeProgress } from '../test/scan-fixtures'
import {
  actionError,
  createWorkspaceStore,
  driveRootOf,
  effectiveSort,
  FOLDER_PICKER_ERROR,
  GONE_MESSAGE,
  NETWORK_PATH_ERROR,
  PATH_COPIED,
  SCAN_CRASH_MESSAGE,
  START_SCAN_ERROR,
} from './workspace-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

async function scanning(api = createFakeApi()) {
  const store = createWorkspaceStore(api)
  await store.getState().startScan('D:\\')
  return { api, store }
}

describe('createWorkspaceStore', () => {
  it('starts empty and subscribes to the five events', () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    expect(store.getState()).toMatchObject({
      phase: 'empty',
      target: null,
      scanId: null,
      mode: 'size',
      unit: 'auto',
      sortColumn: null,
      sortDir: 'desc',
      treemapVisible: true,
      treemapDepth: 1,
      banner: null,
    })
    expect(api.listenerCount()).toBe(5)
    store.dispose()
    expect(api.listenerCount()).toBe(0)
  })

  it('loads drives and places for the Select menu', async () => {
    const store = createWorkspaceStore(createFakeApi())
    await store.getState().loadMenuData()
    expect(store.getState()).toMatchObject({
      drives: TEST_DRIVES,
      places: TEST_PLACES,
      menuDataStatus: 'ready',
    })
  })

  it('keeps what it could load when one list fails', async () => {
    const api = createFakeApi({ listDrives: vi.fn().mockRejectedValue(new Error('koffi')) })
    const store = createWorkspaceStore(api)
    await store.getState().loadMenuData()
    expect(store.getState()).toMatchObject({
      drives: [],
      places: TEST_PLACES,
      menuDataStatus: 'error',
    })
  })
})

describe('a scan', () => {
  it('starts with the root expanded and selected, and loads the drive details', async () => {
    const { api, store } = await scanning()
    expect(api.startScan).toHaveBeenCalledWith('D:\\')
    expect(api.getDriveInfo).toHaveBeenCalledWith('D:\\')
    await flush()
    expect(store.getState()).toMatchObject({
      phase: 'scanning',
      target: 'D:\\',
      scanId: 'scan-1',
      selectedId: 'd0',
      treemapRootId: 'd0',
      drive: TEST_DRIVE_DETAILS,
    })
    expect([...store.getState().expanded]).toEqual(['d0'])
  })

  it('applies progress of its own scan only and bumps the revision', async () => {
    const { api, store } = await scanning()
    const before = store.getState().revision
    api.emitScanProgress(makeProgress({ scanId: 'other' }))
    expect(store.getState().totals.files).toBe(0)
    api.emitScanProgress(makeProgress())
    expect(store.getState().totals).toEqual({
      files: 420,
      folders: 17,
      bytes: 5 * 1024 ** 2,
      allocatedBytes: 6 * 1024 ** 2,
      errorCount: 0,
    })
    expect(store.getState().revision).toBe(before + 1)
  })

  it('ends with the totals and errors; a canceled scan keeps its partial tree', async () => {
    const { api, store } = await scanning()
    api.emitScanDone(makeDone())
    expect(store.getState()).toMatchObject({ phase: 'done', errors: makeDone().errors })
    expect(store.getState().totals.errorCount).toBe(2)

    const second = await scanning()
    second.api.emitScanDone(makeDone({ status: 'canceled' }))
    expect(second.store.getState().phase).toBe('canceled')
  })

  it('shows the crash banner when the scanner fails, and Retry scans again', async () => {
    const { api, store } = await scanning()
    api.emitScanFailed(makeFailed())
    expect(store.getState()).toMatchObject({
      phase: 'failed',
      banner: { tone: 'crash', message: SCAN_CRASH_MESSAGE },
    })
    await store.getState().rescan()
    expect(api.startScan).toHaveBeenCalledTimes(2)
    expect(store.getState().banner).toBeNull()
  })

  it('replays events that arrive before scan:start returns', async () => {
    const pending = deferred<ScanStartResult>()
    const api = createFakeApi({ startScan: vi.fn(() => pending.promise) })
    const store = createWorkspaceStore(api)
    const starting = store.getState().startScan('D:\\')
    api.emitScanDone(makeDone())
    expect(store.getState().phase).toBe('scanning')
    pending.resolve({ scanId: 'scan-1' })
    await starting
    expect(store.getState().phase).toBe('done')
  })

  it('stops the running scan, also when Stop comes before the id is known', async () => {
    const { api, store } = await scanning()
    await store.getState().stopScan()
    expect(api.cancelScan).toHaveBeenCalledWith('scan-1')

    const pending = deferred<ScanStartResult>()
    const slow = createFakeApi({ startScan: vi.fn(() => pending.promise) })
    const slowStore = createWorkspaceStore(slow)
    const starting = slowStore.getState().startScan('D:\\')
    await slowStore.getState().stopScan()
    pending.resolve({ scanId: 'scan-7' })
    await starting
    expect(slow.cancelScan).toHaveBeenCalledWith('scan-7')
  })

  it('refuses network paths and reports a failed start', async () => {
    const api = createFakeApi({ startScan: vi.fn().mockRejectedValue(new Error('Invalid')) })
    const store = createWorkspaceStore(api)
    await store.getState().startScan('\\\\server\\share')
    expect(store.getState().banner).toEqual({ tone: 'error', message: NETWORK_PATH_ERROR })
    expect(api.startScan).not.toHaveBeenCalled()
    await store.getState().startScan('D:\\Gone')
    expect(store.getState()).toMatchObject({
      phase: 'empty',
      banner: { tone: 'error', message: START_SCAN_ERROR },
    })
  })

  it('scans the folder chosen in the picker and reports a picker failure', async () => {
    const api = createFakeApi({
      selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Projects' }),
    })
    const store = createWorkspaceStore(api)
    await store.getState().chooseFolder()
    expect(api.startScan).toHaveBeenCalledWith('D:\\Projects')

    const broken = createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('down')) })
    const brokenStore = createWorkspaceStore(broken)
    await brokenStore.getState().chooseFolder()
    expect(brokenStore.getState().banner).toEqual({ tone: 'error', message: FOLDER_PICKER_ERROR })
    brokenStore.getState().dismissBanner()
    expect(brokenStore.getState().banner).toBeNull()
  })

  it('updates totals when a folder is refreshed (tree:changed)', async () => {
    const { api, store } = await scanning()
    api.emitScanDone(makeDone())
    const before = store.getState().revision
    api.emitTreeChanged({
      scanId: 'scan-1',
      nodeId: 'd1',
      totals: { files: 9, folders: 2, bytes: 10, allocatedBytes: 4096 },
    })
    expect(store.getState().totals).toEqual({
      files: 9,
      folders: 2,
      bytes: 10,
      allocatedBytes: 4096,
      errorCount: 2,
    })
    expect(store.getState().revision).toBe(before + 1)
  })
})

describe('a main-initiated rescan', () => {
  it('adopts the new scan id and ignores the old one', async () => {
    const { api, store } = await scanning()
    store.getState().select('d1')
    api.emitScanRestarted({ scanId: 'scan-2', root: 'D:\\' })
    expect(store.getState()).toMatchObject({
      phase: 'scanning',
      target: 'D:\\',
      scanId: 'scan-2',
      selectedId: 'd0',
      treemapRootId: 'd0',
      lists: {},
    })
    expect(api.startScan).toHaveBeenCalledTimes(1)
    api.emitScanProgress(makeProgress({ scanId: 'scan-1', files: 5 }))
    expect(store.getState().totals.files).toBe(0)
    api.emitScanProgress(makeProgress({ scanId: 'scan-2', files: 77 }))
    expect(store.getState().totals.files).toBe(77)
  })

  it('unsubscribes on dispose', () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    expect(api.onScanRestarted).toHaveBeenCalledTimes(1)
    store.dispose()
    expect(api.listenerCount()).toBe(0)
  })
})

describe('tree data', () => {
  it('loads requested chunks with the current sort and skips fresh ones', async () => {
    const { api, store } = await scanning()
    store.getState().requestChunks([{ nodeId: 'd0', chunk: 0 }])
    await flush()
    expect(api.getChildren).toHaveBeenCalledWith('scan-1', 'd0', 'size', 'desc', 0, 200)
    expect(store.getState().lists['d0']?.total).toBe(3)
    store.getState().requestChunks([{ nodeId: 'd0', chunk: 0 }])
    await flush()
    expect(api.getChildren).toHaveBeenCalledTimes(1)
  })

  it('reloads a chunk after the revision changes', async () => {
    const { api, store } = await scanning()
    store.getState().requestChunks([{ nodeId: 'd0', chunk: 0 }])
    await flush()
    api.emitScanProgress(makeProgress())
    store.getState().requestChunks([{ nodeId: 'd0', chunk: 0 }])
    await flush()
    expect(api.getChildren).toHaveBeenCalledTimes(2)
  })

  it('sorts by a column, reverses on a second click and follows the Mode for % of Parent', async () => {
    const { store } = await scanning()
    expect(effectiveSort(store.getState())).toEqual({ key: 'size', dir: 'desc' })
    store.getState().sortBy('name')
    expect(effectiveSort(store.getState())).toEqual({ key: 'name', dir: 'asc' })
    store.getState().sortBy('name')
    expect(effectiveSort(store.getState())).toEqual({ key: 'name', dir: 'desc' })
    store.getState().sortBy('percent')
    store.getState().setMode('allocated')
    expect(effectiveSort(store.getState())).toEqual({ key: 'allocated', dir: 'desc' })
    store.getState().sortBy('percent')
    expect(effectiveSort(store.getState())).toEqual({ key: 'allocated', dir: 'asc' })
    expect(store.getState().lists).toEqual({})
  })

  it('expands to a number of levels with the ids the scanner returns', async () => {
    const { api, store } = await scanning()
    await store.getState().expandLevels(2)
    expect(api.getExpandIds).toHaveBeenCalledWith('scan-1', 'd0', 2)
    expect([...store.getState().expanded]).toEqual(['d0', 'd1'])
  })

  it('selecting a row in the tree points the treemap at it', async () => {
    const { store } = await scanning()
    store.getState().select('d1')
    expect(store.getState()).toMatchObject({ selectedId: 'd1', treemapRootId: 'd1' })
  })

  it('reveal expands the ancestors, loads the row and scrolls to it without moving the treemap', async () => {
    const { store } = await scanning()
    await store.getState().reveal('f1')
    expect([...store.getState().expanded].sort()).toEqual(['d0', 'd1', 'g1'])
    expect(store.getState().lists['g1']?.chunks[0]?.rows[0]?.id).toBe('f1')
    expect(store.getState()).toMatchObject({
      selectedId: 'f1',
      treemapRootId: 'd0',
      scrollTarget: { id: 'f1', seq: 1 },
    })
  })

  it('drillInto shows the folder in the treemap; files cannot be drilled into', async () => {
    const { store } = await scanning()
    await store.getState().drillInto('d1')
    expect(store.getState()).toMatchObject({ selectedId: 'd1', treemapRootId: 'd1' })
    await store.getState().drillInto('f1')
    expect(store.getState().treemapRootId).toBe('d1')
  })
})

describe('actions on a row', () => {
  it('copies the path through main and announces it', async () => {
    const { api, store } = await scanning()
    await store.getState().copyPath('d1')
    expect(api.copyNodePath).toHaveBeenCalledWith('scan-1', 'd1')
    expect(store.getState().announcement).toBe(PATH_COPIED)
  })

  it('opens the Explorer context menu at the given point and handles its outcome', async () => {
    const api = createFakeApi({
      showContextMenu: vi.fn(async () => ({
        kind: 'created' as const,
        nodeId: 'd1',
        name: 'New folder',
      })),
    })
    const { store } = await scanning(api)
    await store.getState().showContextMenu('d1', 10.6, 20.2, true)
    expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', 'd1', 11, 20, true)
    expect(store.getState().announcement).toBe('Created “New folder”.')
  })

  it('gone outcome clears the selection and announces it', async () => {
    const api = createFakeApi({ showContextMenu: vi.fn(async () => ({ kind: 'gone' as const })) })
    const { store } = await scanning(api)
    store.setState({ selectedId: 'd1' })
    await store.getState().showContextMenu('d1', 1, 2, false)
    const state = store.getState()
    expect(state.selectedId).toBeNull()
    expect(state.announcement).toBe(GONE_MESSAGE)
    expect(state.banner).toBeNull()
    expect(GONE_MESSAGE).not.toMatch(/0x/)
  })

  it('creates a folder, opens in Explorer, and reports failures', async () => {
    const api = createFakeApi({
      openInExplorer: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Error invoking remote method 'shell:open-in-explorer': Error: Access is denied.",
          ),
        ),
    })
    const { store } = await scanning(api)
    await store.getState().createFolder('d1')
    expect(api.createFolder).toHaveBeenCalledWith('scan-1', 'd1')
    await store.getState().openInExplorer('d1')
    expect(store.getState().banner).toEqual({
      tone: 'error',
      message: 'StorageIQ couldn’t do that: Access is denied.',
    })
  })

  it('lays out the treemap of the treemap root with the Mode and depth', async () => {
    const { api, store } = await scanning()
    store.getState().setTreemapDepth(9)
    store.getState().setMode('files')
    const layout = await store.getState().fetchTreemap(400.4, 200)
    expect(api.getTreemap).toHaveBeenCalledWith('scan-1', 'd0', 'files', 5, 400, 200)
    expect(layout?.rects).toHaveLength(2)
    store.getState().setTreemapVisible(false)
    expect(store.getState().treemapVisible).toBe(false)
  })

  it('quits through main', async () => {
    const api = createFakeApi()
    await createWorkspaceStore(api).getState().quit()
    expect(api.quit).toHaveBeenCalled()
  })
})

describe('helpers', () => {
  it('driveRootOf and actionError', () => {
    expect(driveRootOf('d:\\Photos')).toBe('D:\\')
    expect(driveRootOf('\\\\srv\\x')).toBeNull()
    expect(actionError('x')).toBe('StorageIQ couldn’t do that.')
  })
})
