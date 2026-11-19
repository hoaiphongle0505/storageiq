import { describe, expect, it, vi } from 'vitest'
import type { SelectFolderResult } from '@shared/ipc-contract'
import type { ScanStartResult } from '@shared/scan-types'
import { createFakeApi, TEST_DRIVES } from '../test/fake-api'
import { makeDone, makeFailed, makeProgress } from '../test/scan-fixtures'
import {
  createScanStore,
  FOLDER_PICKER_ERROR,
  NETWORK_PATH_ERROR,
  START_SCAN_ERROR,
} from './scan-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function scanning(api = createFakeApi()) {
  const store = createScanStore(api)
  await store.getState().startScan('D:\\')
  return { api, store }
}

describe('createScanStore', () => {
  it('starts idle and subscribes to the three scan events', () => {
    const api = createFakeApi()
    const store = createScanStore(api)
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      drives: [],
      drivesStatus: 'idle',
      target: null,
      scanId: null,
      progress: null,
      result: null,
      folderPickerOpen: false,
      errorMessage: null,
    })
    expect(api.listenerCount()).toBe(3)
  })

  describe('loadDrives', () => {
    it('loads the drives', async () => {
      const store = createScanStore(createFakeApi())
      await store.getState().loadDrives()
      expect(store.getState()).toMatchObject({ drives: TEST_DRIVES, drivesStatus: 'ready' })
    })

    it('marks the list as failed when the drives cannot be listed', async () => {
      const api = createFakeApi({ listDrives: vi.fn().mockRejectedValue(new Error('koffi')) })
      const store = createScanStore(api)
      await store.getState().loadDrives()
      expect(store.getState().drivesStatus).toBe('error')
    })
  })

  describe('a scan', () => {
    it('starts and keeps its id', async () => {
      const { api, store } = await scanning()
      expect(api.startScan).toHaveBeenCalledWith('D:\\')
      expect(store.getState()).toMatchObject({
        phase: 'scanning',
        target: 'D:\\',
        scanId: 'scan-1',
      })
    })

    it('applies progress of its own scan and ignores other scans', async () => {
      const { api, store } = await scanning()
      api.emitScanProgress(makeProgress({ scanId: 'other' }))
      expect(store.getState().progress).toBeNull()
      api.emitScanProgress(makeProgress())
      expect(store.getState().progress).toEqual(makeProgress())
    })

    it('shows the result when the scan completes', async () => {
      const { api, store } = await scanning()
      api.emitScanProgress(makeProgress())
      api.emitScanDone(makeDone())
      expect(store.getState()).toMatchObject({ phase: 'done', result: makeDone(), progress: null })
    })

    it('treats a canceled scan as partial results', async () => {
      const { api, store } = await scanning()
      api.emitScanDone(makeDone({ status: 'canceled' }))
      expect(store.getState().phase).toBe('canceled')
    })

    it('moves to the failed state when the scanner crashes', async () => {
      const { api, store } = await scanning()
      api.emitScanFailed(makeFailed())
      expect(store.getState().phase).toBe('failed')
    })

    it('replays events that arrive before scan:start returns', async () => {
      const pending = deferred<ScanStartResult>()
      const api = createFakeApi({ startScan: vi.fn(() => pending.promise) })
      const store = createScanStore(api)

      const starting = store.getState().startScan('D:\\')
      api.emitScanProgress(makeProgress())
      api.emitScanDone(makeDone())
      expect(store.getState().phase).toBe('scanning')
      pending.resolve({ scanId: 'scan-1' })
      await starting

      expect(store.getState()).toMatchObject({ phase: 'done', result: makeDone() })
    })

    it('asks main to cancel the running scan', async () => {
      const { api, store } = await scanning()
      await store.getState().cancelScan()
      expect(api.cancelScan).toHaveBeenCalledWith('scan-1')
    })

    it('cancels as soon as the id is known when Cancel comes first', async () => {
      const pending = deferred<ScanStartResult>()
      const api = createFakeApi({ startScan: vi.fn(() => pending.promise) })
      const store = createScanStore(api)

      const starting = store.getState().startScan('D:\\')
      await store.getState().cancelScan()
      expect(api.cancelScan).not.toHaveBeenCalled()
      pending.resolve({ scanId: 'scan-7' })
      await starting

      expect(api.cancelScan).toHaveBeenCalledWith('scan-7')
    })

    it('returns to the start with an error when the scan cannot start', async () => {
      const api = createFakeApi({ startScan: vi.fn().mockRejectedValue(new Error('Invalid')) })
      const store = createScanStore(api)
      await store.getState().startScan('D:\\Gone')
      expect(store.getState()).toMatchObject({ phase: 'idle', errorMessage: START_SCAN_ERROR })
    })

    it('refuses network paths without asking main', async () => {
      const api = createFakeApi()
      const store = createScanStore(api)
      await store.getState().startScan('\\\\server\\share')
      expect(api.startScan).not.toHaveBeenCalled()
      expect(store.getState()).toMatchObject({ phase: 'idle', errorMessage: NETWORK_PATH_ERROR })
    })

    it('ignores scan events when no scan is running', () => {
      const api = createFakeApi()
      const store = createScanStore(api)
      api.emitScanDone(makeDone())
      expect(store.getState()).toMatchObject({ phase: 'idle', result: null })
    })
  })

  describe('chooseFolder', () => {
    it('scans the folder the user picked', async () => {
      const api = createFakeApi({
        selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Projects' }),
      })
      const store = createScanStore(api)
      await store.getState().chooseFolder()
      expect(api.startScan).toHaveBeenCalledWith('D:\\Projects')
      expect(store.getState()).toMatchObject({ phase: 'scanning', folderPickerOpen: false })
    })

    it('stays on the start screen when the user cancels the picker', async () => {
      const api = createFakeApi()
      const store = createScanStore(api)
      await store.getState().chooseFolder()
      expect(api.startScan).not.toHaveBeenCalled()
      expect(store.getState()).toMatchObject({ phase: 'idle', folderPickerOpen: false })
    })

    it('shows a friendly error when the picker fails, and can dismiss it', async () => {
      const api = createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('IPC down')) })
      const store = createScanStore(api)
      await store.getState().chooseFolder()
      expect(store.getState()).toMatchObject({
        folderPickerOpen: false,
        errorMessage: FOLDER_PICKER_ERROR,
      })
      store.getState().dismissError()
      expect(store.getState().errorMessage).toBeNull()
    })

    it('ignores a second request while the picker is open', async () => {
      const pending = deferred<SelectFolderResult>()
      const api = createFakeApi({ selectFolder: vi.fn(() => pending.promise) })
      const store = createScanStore(api)

      const first = store.getState().chooseFolder()
      expect(store.getState().folderPickerOpen).toBe(true)
      await store.getState().chooseFolder()
      pending.resolve({ canceled: true })
      await first

      expect(api.selectFolder).toHaveBeenCalledTimes(1)
    })
  })

  describe('after a scan', () => {
    it('rescan scans the same location again', async () => {
      const { api, store } = await scanning()
      api.emitScanDone(makeDone())
      await store.getState().rescan()
      expect(api.startScan).toHaveBeenCalledTimes(2)
      expect(api.startScan).toHaveBeenLastCalledWith('D:\\')
      expect(store.getState().phase).toBe('scanning')
    })

    it('chooseAnotherLocation returns to the start screen', async () => {
      const { api, store } = await scanning()
      api.emitScanDone(makeDone())
      store.getState().chooseAnotherLocation()
      expect(store.getState()).toMatchObject({ phase: 'idle', result: null, target: 'D:\\' })
    })
  })

  it('dispose unsubscribes from every event', () => {
    const api = createFakeApi()
    const store = createScanStore(api)
    store.dispose()
    expect(api.listenerCount()).toBe(0)
  })
})
