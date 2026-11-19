import { describe, expect, it, vi } from 'vitest'
import type { AppInfo } from '@shared/ipc-contract'
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
  it('starts idle', () => {
    expect(createAppStore(createFakeApi()).getState()).toMatchObject({
      appInfo: null,
      appInfoStatus: 'idle',
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

    it('retries after an error (roadmap carry-over 6)', async () => {
      const getAppInfo = vi
        .fn<() => Promise<AppInfo>>()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(TEST_APP_INFO)
      const store = createAppStore(createFakeApi({ getAppInfo }))

      await store.getState().loadAppInfo()
      expect(store.getState().appInfoStatus).toBe('error')
      await store.getState().loadAppInfo()

      expect(getAppInfo).toHaveBeenCalledTimes(2)
      expect(store.getState()).toMatchObject({ appInfo: TEST_APP_INFO, appInfoStatus: 'ready' })
    })
  })
})
