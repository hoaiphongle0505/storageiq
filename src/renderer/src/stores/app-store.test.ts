import { describe, expect, it, vi } from 'vitest'
import type { AppInfo, SelectFolderResult } from '@shared/ipc-contract'
import { createFakeApi, TEST_APP_INFO } from '../test/fake-api'
import { createAppStore } from './app-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('createAppStore', () => {
  it('starts idle with no folder selected', () => {
    const state = createAppStore(createFakeApi()).getState()
    expect(state).toMatchObject({
      appInfo: null,
      appInfoStatus: 'idle',
      scanTarget: null,
      folderPickerOpen: false,
      errorMessage: null,
    })
  })

  describe('loadAppInfo', () => {
    it('stores the app info and becomes ready', async () => {
      const store = createAppStore(createFakeApi())
      await store.getState().loadAppInfo()
      expect(store.getState()).toMatchObject({ appInfo: TEST_APP_INFO, appInfoStatus: 'ready' })
    })

    it('marks an error when the main process fails', async () => {
      const api = createFakeApi({ getAppInfo: vi.fn().mockRejectedValue(new Error('boom')) })
      const store = createAppStore(api)
      await store.getState().loadAppInfo()
      expect(store.getState()).toMatchObject({ appInfo: null, appInfoStatus: 'error' })
    })

    it('requests the info only once while a request is in flight or done', async () => {
      const pending = deferred<AppInfo>()
      const api = createFakeApi({ getAppInfo: vi.fn(() => pending.promise) })
      const store = createAppStore(api)

      const first = store.getState().loadAppInfo()
      void store.getState().loadAppInfo()
      pending.resolve(TEST_APP_INFO)
      await first
      await store.getState().loadAppInfo()

      expect(api.getAppInfo).toHaveBeenCalledTimes(1)
    })
  })

  describe('chooseFolder', () => {
    it('stores the folder the user picked', async () => {
      const api = createFakeApi({
        selectFolder: vi.fn().mockResolvedValue({ canceled: false, path: 'D:\\Photos' }),
      })
      const store = createAppStore(api)
      await store.getState().chooseFolder()
      expect(store.getState()).toMatchObject({ scanTarget: 'D:\\Photos', folderPickerOpen: false })
    })

    it('keeps the previous folder when the user cancels', async () => {
      const selectFolder = vi
        .fn<() => Promise<SelectFolderResult>>()
        .mockResolvedValueOnce({ canceled: false, path: 'D:\\Photos' })
        .mockResolvedValueOnce({ canceled: true })
      const store = createAppStore(createFakeApi({ selectFolder }))

      await store.getState().chooseFolder()
      await store.getState().chooseFolder()

      expect(store.getState().scanTarget).toBe('D:\\Photos')
    })

    it('ignores a second request while the picker is already open', async () => {
      const pending = deferred<SelectFolderResult>()
      const api = createFakeApi({ selectFolder: vi.fn(() => pending.promise) })
      const store = createAppStore(api)

      const first = store.getState().chooseFolder()
      expect(store.getState().folderPickerOpen).toBe(true)
      await store.getState().chooseFolder()
      pending.resolve({ canceled: true })
      await first

      expect(api.selectFolder).toHaveBeenCalledTimes(1)
      expect(store.getState().folderPickerOpen).toBe(false)
    })

    it('shows a friendly error when the picker fails, and can dismiss it', async () => {
      const api = createFakeApi({ selectFolder: vi.fn().mockRejectedValue(new Error('IPC down')) })
      const store = createAppStore(api)

      await store.getState().chooseFolder()
      expect(store.getState()).toMatchObject({
        folderPickerOpen: false,
        errorMessage: 'StorageIQ couldn’t open the folder picker. Please try again.',
      })

      store.getState().dismissError()
      expect(store.getState().errorMessage).toBeNull()
    })
  })
})
