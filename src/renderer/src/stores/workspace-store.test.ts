import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveDetails, ScanStartResult } from '@shared/scan-types'
import type { ContextMenuOutcome, UpdateState } from '@shared/ipc-contract'
import { createFakeApi, TEST_DRIVE_DETAILS, TEST_DRIVES, TEST_PLACES } from '../test/fake-api'
import { makeDone, makeFailed, makeProgress } from '../test/scan-fixtures'
import {
  actionError,
  BUSY_MESSAGE,
  createWorkspaceStore,
  driveRootOf,
  effectiveSort,
  FOLDER_PICKER_ERROR,
  GONE_MESSAGE,
  NETWORK_PATH_ERROR,
  PATH_COPIED,
  REVISION_THROTTLE_MS,
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
  it('starts empty and subscribes to the six events', () => {
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
    expect(api.listenerCount()).toBe(6)
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

  it('shows the crash banner when the scanner dies after the scan finished', async () => {
    const { api, store } = await scanning()
    api.emitScanDone(makeDone())
    expect(store.getState().phase).toBe('done')
    api.emitScanFailed(makeFailed())
    expect(store.getState()).toMatchObject({
      phase: 'failed',
      banner: { tone: 'crash', message: SCAN_CRASH_MESSAGE },
    })
  })

  it('ignores a failure for another scan once the scan has finished', async () => {
    const { api, store } = await scanning()
    api.emitScanDone(makeDone())
    api.emitScanFailed(makeFailed({ scanId: 'older-scan' }))
    expect(store.getState().phase).toBe('done')
  })

  it('shows the failure text the scanner sent, and the generic one when it sent none', async () => {
    const first = await scanning()
    first.api.emitScanFailed(makeFailed({ message: 'The disk reader could not be loaded.' }))
    expect(first.store.getState().banner).toEqual({
      tone: 'crash',
      message: 'The disk reader could not be loaded.',
    })
    const second = await scanning()
    second.api.emitScanFailed(makeFailed({ message: '' }))
    expect(second.store.getState().banner).toEqual({ tone: 'crash', message: SCAN_CRASH_MESSAGE })
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

  it('drops a drive reply that arrives after the scan was replaced', async () => {
    const stale = deferred<DriveDetails>()
    const fresh = { ...TEST_DRIVE_DETAILS, freeBytes: 1 }
    const getDriveInfo = vi
      .fn<() => Promise<DriveDetails>>()
      .mockResolvedValueOnce(TEST_DRIVE_DETAILS) // startScan
      .mockResolvedValueOnce(TEST_DRIVE_DETAILS) // scan:done
      .mockReturnValueOnce(stale.promise) // tree:changed
      .mockResolvedValue(fresh) // the restart
    const { api, store } = await scanning(createFakeApi({ getDriveInfo }))
    api.emitScanDone(makeDone())
    await flush()
    api.emitTreeChanged({
      scanId: 'scan-1',
      nodeId: 'd1',
      totals: { files: 9, folders: 2, bytes: 10, allocatedBytes: 4096 },
    })
    api.emitScanRestarted({ scanId: 'scan-2', root: 'D:\\' })
    await flush()
    expect(store.getState().drive).toEqual(fresh)
    stale.resolve({ ...TEST_DRIVE_DETAILS, freeBytes: 999 })
    await flush()
    expect(store.getState().drive).toEqual(fresh)
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

describe('updates', () => {
  it('update:state events set updateState', () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    expect(store.getState().updateState).toEqual({ kind: 'idle' })
    api.emitUpdateState({ kind: 'available', version: '0.2.0' })
    expect(store.getState().updateState).toEqual({ kind: 'available', version: '0.2.0' })
  })

  it('startup pulls the state and subscribes', async () => {
    const api = createFakeApi({
      getUpdateState: vi.fn(async () => ({ kind: 'ready' as const, version: '0.3.0' })),
    })
    const store = createWorkspaceStore(api)
    expect(api.onUpdateState).toHaveBeenCalledTimes(1)
    await flush()
    expect(api.getUpdateState).toHaveBeenCalledTimes(1)
    expect(store.getState().updateState).toEqual({ kind: 'ready', version: '0.3.0' })
  })

  it('dismissUpdate remembers the version and a newer version shows again', () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    api.emitUpdateState({ kind: 'available', version: '0.2.0' })
    store.getState().dismissUpdate()
    expect(store.getState().dismissedUpdateVersion).toBe('0.2.0')
    api.emitUpdateState({ kind: 'available', version: '0.3.0' })
    expect(store.getState().dismissedUpdateVersion).not.toBe('0.3.0')
    // idle states cannot be dismissed
    api.emitUpdateState({ kind: 'idle' })
    store.getState().dismissUpdate()
    expect(store.getState().dismissedUpdateVersion).toBe('0.2.0')
  })

  it('checkForUpdates, downloadUpdate and installUpdate call the api', async () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    await store.getState().checkForUpdates()
    await store.getState().downloadUpdate()
    await store.getState().installUpdate()
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(api.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(api.installUpdate).toHaveBeenCalledTimes(1)
    expect(store.getState().banner).toBeNull()
  })

  it('a failing update call does not throw', async () => {
    const api = createFakeApi({
      installUpdate: vi.fn().mockRejectedValue(new Error('nope')),
      checkForUpdates: vi.fn().mockRejectedValue(new Error('nope')),
      downloadUpdate: vi.fn().mockRejectedValue(new Error('nope')),
      getUpdateState: vi.fn().mockRejectedValue(new Error('nope')),
      getWhatsNewDue: vi.fn().mockRejectedValue(new Error('nope')),
    })
    const store = createWorkspaceStore(api)
    await flush()
    await expect(store.getState().installUpdate()).resolves.toBeUndefined()
    expect(store.getState().banner).toEqual({
      tone: 'error',
      message: actionError(new Error('nope')),
    })
    await expect(store.getState().checkForUpdates()).resolves.toBeUndefined()
    await expect(store.getState().downloadUpdate()).resolves.toBeUndefined()
  })

  it("a due What's new entry opens, is marked seen at once and is not due again", async () => {
    const entry = { version: '0.2.0', date: null, sections: [] }
    let seen = false
    const api = createFakeApi({
      getWhatsNewDue: vi.fn(async () => (seen ? null : entry)),
      markWhatsNewSeen: vi.fn(async () => {
        seen = true
      }),
    })
    const store = createWorkspaceStore(api)
    await flush()
    expect(store.getState().whatsNew).toEqual({ kind: 'installed', version: '0.2.0' })
    expect(api.markWhatsNewSeen).toHaveBeenCalledTimes(1)
    // A second store (a re-init) asks main again and gets nothing.
    const again = createWorkspaceStore(api)
    await flush()
    expect(again.getState().whatsNew).toBeNull()
    expect(api.markWhatsNewSeen).toHaveBeenCalledTimes(1)
  })

  it('a pushed state is not overwritten by a late pull reply', async () => {
    const pull = deferred<UpdateState>()
    const api = createFakeApi({ getUpdateState: vi.fn(() => pull.promise) })
    const store = createWorkspaceStore(api)
    api.emitUpdateState({ kind: 'available', version: '0.3.0' })
    pull.resolve({ kind: 'idle' })
    await flush()
    expect(store.getState().updateState).toEqual({ kind: 'available', version: '0.3.0' })
  })

  it('checkForUpdates leaves the state to the pushed event', async () => {
    const api = createFakeApi({
      checkForUpdates: vi.fn(async () => ({ kind: 'checking' as const })),
    })
    const store = createWorkspaceStore(api)
    await flush()
    await store.getState().checkForUpdates()
    expect(store.getState().updateState).toEqual({ kind: 'idle' })
  })

  it('dismissUpdate also hides a download error until the state changes', () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    api.emitUpdateState({ kind: 'error', message: 'm', during: 'download' })
    store.getState().dismissUpdate()
    expect(store.getState().dismissedDownloadError).toBe(true)
    api.emitUpdateState({ kind: 'checking' })
    expect(store.getState().dismissedDownloadError).toBe(false)
  })

  it('no due entry opens nothing', async () => {
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    await flush()
    expect(store.getState().whatsNew).toBeNull()
    expect(api.markWhatsNewSeen).not.toHaveBeenCalled()
    store.getState().openWhatsNew({ kind: 'history' })
    expect(store.getState().whatsNew).toEqual({ kind: 'history' })
  })
})

describe('a main-initiated rescan', () => {
  it('ignores a restart while a user-started scan is still waiting for its id', async () => {
    const pending = deferred<ScanStartResult>()
    const api = createFakeApi({ startScan: vi.fn(() => pending.promise) })
    const store = createWorkspaceStore(api)
    const starting = store.getState().startScan('D:\\')
    api.emitScanRestarted({ scanId: 'rescan-9', root: 'D:\\' })
    expect(store.getState().scanId).toBeNull()
    pending.resolve({ scanId: 'scan-1' })
    await starting
    expect(store.getState()).toMatchObject({ scanId: 'scan-1', phase: 'scanning' })
  })

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
    await store.getState().copyPaths(['d1'])
    expect(api.copyNodePath).toHaveBeenCalledWith('scan-1', ['d1'])
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
    await store.getState().showContextMenu(['d1'], 10.6, 20.2, true)
    expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['d1'], 11, 20, true)
    expect(store.getState().announcement).toBe('Created “New folder”.')
  })

  it('gone outcome clears the selection and announces it', async () => {
    const api = createFakeApi({ showContextMenu: vi.fn(async () => ({ kind: 'gone' as const })) })
    const { store } = await scanning(api)
    store.setState({ selectedId: 'd1' })
    await store.getState().showContextMenu(['d1'], 1, 2, false)
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

describe('the revision throttle while scanning', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  async function timed() {
    vi.useFakeTimers()
    const api = createFakeApi()
    const store = createWorkspaceStore(api)
    await store.getState().startScan('D:\\')
    return { api, store }
  }

  it('progress events reload at most once per second while scanning', async () => {
    const { api, store } = await timed()
    const before = store.getState().revision
    for (let i = 1; i <= 10; i += 1) {
      api.emitScanProgress(makeProgress({ files: i * 100 }))
      expect(store.getState().totals.files).toBe(i * 100)
      vi.advanceTimersByTime(100)
    }
    expect(store.getState().revision - before).toBe(2) // the leading bump plus one trailing
  })

  it('the first progress event bumps the revision at once', async () => {
    const { api, store } = await timed()
    const before = store.getState().revision
    api.emitScanProgress(makeProgress())
    expect(store.getState().revision).toBe(before + 1)
  })

  it('schedules at most one trailing bump for events inside the window', async () => {
    const { api, store } = await timed()
    const before = store.getState().revision
    api.emitScanProgress(makeProgress({ files: 1 }))
    vi.advanceTimersByTime(100)
    api.emitScanProgress(makeProgress({ files: 2 }))
    api.emitScanProgress(makeProgress({ files: 3 }))
    expect(store.getState().revision).toBe(before + 1)
    vi.advanceTimersByTime(REVISION_THROTTLE_MS - 100)
    expect(store.getState().revision).toBe(before + 2)
    vi.advanceTimersByTime(5_000)
    expect(store.getState().revision).toBe(before + 2)
  })

  it('done bumps the revision immediately and cancels the trailing bump', async () => {
    const { api, store } = await timed()
    const before = store.getState().revision
    api.emitScanProgress(makeProgress({ files: 1 }))
    vi.advanceTimersByTime(100)
    api.emitScanProgress(makeProgress({ files: 2 })) // pending trailing bump
    api.emitScanDone(makeDone())
    expect(store.getState().revision).toBe(before + 2)
    vi.advanceTimersByTime(5_000)
    expect(store.getState().revision).toBe(before + 2)
  })

  it('tree:changed bumps immediately while a trailing timer is pending, and no extra bump follows', async () => {
    const { api, store } = await timed()
    api.emitScanProgress(makeProgress({ files: 1 }))
    vi.advanceTimersByTime(100)
    api.emitScanProgress(makeProgress({ files: 2 })) // pending trailing bump
    const before = store.getState().revision
    api.emitTreeChanged({
      scanId: 'scan-1',
      nodeId: 'd0',
      totals: { files: 5, folders: 1, bytes: 5, allocatedBytes: 4096 },
    })
    expect(store.getState().revision).toBe(before + 1)
    vi.advanceTimersByTime(5_000)
    expect(store.getState().revision).toBe(before + 1)
  })

  it('dispose clears the pending timer', async () => {
    const { api, store } = await timed()
    api.emitScanProgress(makeProgress({ files: 1 }))
    vi.advanceTimersByTime(100)
    api.emitScanProgress(makeProgress({ files: 2 })) // pending trailing bump
    const before = store.getState().revision
    store.dispose()
    vi.advanceTimersByTime(5_000)
    expect(store.getState().revision).toBe(before)
  })
})

describe('multi-select', () => {
  const TOTALS = { files: 1, folders: 1, bytes: 1, allocatedBytes: 1 }
  const changed = (api: ReturnType<typeof createFakeApi>) =>
    api.emitTreeChanged({ scanId: 'scan-1', nodeId: 'd1', totals: TOTALS })

  it('setSelection keeps selectedId as the active row', async () => {
    const { store } = await scanning()
    store.getState().setSelection({ ids: new Set(['d1', 'd2']), activeId: 'd2', anchorId: 'd1' })
    expect(store.getState()).toMatchObject({
      selectedId: 'd2',
      anchorId: 'd1',
      treemapRootId: 'd2',
    })
    expect([...store.getState().selectedIds].sort()).toEqual(['d1', 'd2'])
  })

  it('select resets the set to one row', async () => {
    const { store } = await scanning()
    store.getState().setSelection({ ids: new Set(['d1', 'd2']), activeId: 'd2', anchorId: 'd1' })
    store.getState().select('d1')
    expect([...store.getState().selectedIds]).toEqual(['d1'])
    expect(store.getState()).toMatchObject({ selectedId: 'd1', anchorId: 'd1' })
  })

  it('a new scan clears the selection to the root', async () => {
    const { store } = await scanning()
    store.getState().setSelection({ ids: new Set(['d1', 'd2']), activeId: 'd2', anchorId: 'd1' })
    await store.getState().startScan('D:\\')
    expect([...store.getState().selectedIds]).toEqual(['d0'])
    expect(store.getState()).toMatchObject({ selectedId: 'd0', anchorId: 'd0' })
  })

  it('tree:changed prunes selected ids that no longer resolve', async () => {
    const { api, store } = await scanning()
    const original = createFakeApi()
    vi.mocked(api.getNode).mockImplementation(async (scanId, nodeId, key, dir) =>
      nodeId === 'd2' ? null : original.getNode(scanId, nodeId, key, dir),
    )
    store.getState().setSelection({ ids: new Set(['d1', 'd2']), activeId: 'd2', anchorId: 'd1' })
    changed(api)
    await flush()
    expect([...store.getState().selectedIds]).toEqual(['d1'])
    // The active row vanished: the first remaining selected row takes over.
    expect(store.getState().selectedId).toBe('d1')
  })

  it('more than 200 selected ids collapse to the active row on tree:changed', async () => {
    const { api, store } = await scanning()
    const ids = Array.from({ length: 201 }, (_, i) => `f${i + 10}`)
    store.getState().setSelection({ ids: new Set(ids), activeId: 'f10', anchorId: 'f10' })
    vi.mocked(api.getNode).mockClear()
    changed(api)
    await flush()
    expect([...store.getState().selectedIds]).toEqual(['f10'])
    expect(api.getNode).not.toHaveBeenCalled()
  })

  it('a result that arrives after a new scan is ignored', async () => {
    const pending = deferred<null>()
    const { api, store } = await scanning()
    vi.mocked(api.getNode).mockImplementation(() => pending.promise)
    store.getState().setSelection({ ids: new Set(['d1', 'd2']), activeId: 'd2', anchorId: 'd1' })
    changed(api)
    await store.getState().startScan('D:\\')
    pending.resolve(null)
    await flush()
    expect([...store.getState().selectedIds]).toEqual(['d0'])
    expect(store.getState().selectedId).toBe('d0')
  })

  it('showContextMenu sends all ids in order', async () => {
    const { api, store } = await scanning()
    await store.getState().showContextMenu(['d2', 'f1', 'd1'], 5, 6, false)
    expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['d2', 'f1', 'd1'], 5, 6, false)
  })

  it('showContextMenu does not send rows inside another selected row', async () => {
    const { api, store } = await scanning()
    store.getState().requestChunks([
      { nodeId: 'd0', chunk: 0 },
      { nodeId: 'd1', chunk: 0 },
    ])
    await flush()
    await store.getState().showContextMenu(['d1', 'd3', 'd2'], 5, 6, false)
    expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['d1', 'd2'], 5, 6, false)
  })

  it('more than 1000 rows announce the limit and send nothing', async () => {
    const { api, store } = await scanning()
    const ids = Array.from({ length: 1001 }, (_, i) => `f${i + 10}`)
    await store.getState().showContextMenu(ids, 5, 6, false)
    expect(api.showContextMenu).not.toHaveBeenCalled()
    expect(store.getState().announcement).toBe('Too many items selected (the limit is 1,000).')
  })

  it('a busy outcome announces the busy message', async () => {
    const api = createFakeApi({ showContextMenu: vi.fn(async () => ({ kind: 'busy' as const })) })
    const { store } = await scanning(api)
    await store.getState().showContextMenu(['d1'], 1, 2, false)
    expect(store.getState().announcement).toBe(BUSY_MESSAGE)
  })

  it('a shell outcome announces that Windows is working on N items', async () => {
    const outcome: ContextMenuOutcome = {
      kind: 'shell',
      verb: 'cut',
      changed: true,
      count: 3,
      running: true,
    }
    const api = createFakeApi({ showContextMenu: vi.fn(async () => outcome) })
    const { store } = await scanning(api)
    await store.getState().showContextMenu(['d1', 'd2', 'g0'], 1, 2, false)
    expect(store.getState().announcement).toBe('Windows is working on 3 items…')
    vi.mocked(api.showContextMenu).mockResolvedValue({ ...outcome, count: 1 })
    await store.getState().showContextMenu(['d1'], 1, 2, false)
    expect(store.getState().announcement).toBe('Windows is working on 1 item…')
  })

  it('announces how many rows were skipped', async () => {
    const outcome: ContextMenuOutcome = {
      kind: 'shell',
      verb: 'properties',
      changed: false,
      count: 1,
      running: true,
    }
    const api = createFakeApi({ showContextMenu: vi.fn(async () => outcome) })
    const { store } = await scanning(api)
    await store.getState().showContextMenu(['d0', 'd2', 'g0'], 1, 2, false)
    expect(store.getState().announcement).toBe(
      'Windows is working on 1 item… Skipped 2 rows that cannot be acted on.',
    )
  })

  it('a delete outcome reduces the selection to the active row', async () => {
    const outcome: ContextMenuOutcome = {
      kind: 'shell',
      verb: 'delete',
      changed: true,
      count: 2,
      running: true,
    }
    const api = createFakeApi({ showContextMenu: vi.fn(async () => outcome) })
    const { store } = await scanning(api)
    store.getState().setSelection({ ids: new Set(['d1', 'd2']), activeId: 'd2', anchorId: 'd1' })
    await store.getState().showContextMenu(['d1', 'd2'], 1, 2, false)
    expect([...store.getState().selectedIds]).toEqual(['d2'])
    expect(store.getState().selectedId).toBe('d2')
  })

  it('copyPaths announces the count', async () => {
    const { api, store } = await scanning()
    await store.getState().copyPaths(['d1', 'd2', 'g0'])
    expect(api.copyNodePath).toHaveBeenCalledWith('scan-1', ['d1', 'd2', 'g0'])
    expect(store.getState().announcement).toBe('Copied 3 paths.')
    await store.getState().copyPaths(['d1'])
    expect(store.getState().announcement).toBe(PATH_COPIED)
  })

  it('Ctrl+A over the root and its loaded children sends the children, not the root', async () => {
    const outcome: ContextMenuOutcome = {
      kind: 'shell',
      verb: 'properties',
      changed: false,
      count: 2,
      running: true,
    }
    const api = createFakeApi({ showContextMenu: vi.fn(async () => outcome) })
    const { store } = await scanning(api)
    store.getState().requestChunks([{ nodeId: 'd0', chunk: 0 }])
    await flush()
    await store.getState().showContextMenu(['d0', 'd1', 'd2'], 1, 2, false)
    expect(api.showContextMenu).toHaveBeenCalledWith('scan-1', ['d1', 'd2'], 1, 2, false)
    expect(store.getState().announcement).toBe(
      'Windows is working on 2 items… Skipped 1 row that cannot be acted on.',
    )
  })

  it('copyPaths with 1001 ids announces the limit and sends nothing', async () => {
    const { api, store } = await scanning()
    const ids = Array.from({ length: 1001 }, (_, i) => `f${i + 10}`)
    await store.getState().copyPaths(ids)
    expect(api.copyNodePath).not.toHaveBeenCalled()
    expect(store.getState().announcement).toBe('Too many items selected (the limit is 1,000).')
    expect(store.getState().banner).toBeNull()
  })

  it('when every selected row is dropped the skipped rows are announced and no menu is requested', async () => {
    const { api, store } = await scanning()
    await store.getState().showContextMenu(['d0', 'g0'], 1, 2, false)
    expect(api.showContextMenu).not.toHaveBeenCalled()
    expect(store.getState().announcement).toBe('Skipped 2 rows that cannot be acted on.')
  })
})
