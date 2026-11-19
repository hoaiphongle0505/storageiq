import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AppInfo, StorageIQApi } from '@shared/ipc-contract'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AppState {
  appInfo: AppInfo | null
  appInfoStatus: LoadStatus
  loadAppInfo(): Promise<void>
}

export type AppStore = StoreApi<AppState>

export function createAppStore(api: StorageIQApi): AppStore {
  return createStore<AppState>()((set, get) => ({
    appInfo: null,
    appInfoStatus: 'idle',

    async loadAppInfo() {
      const status = get().appInfoStatus
      if (status === 'loading' || status === 'ready') return
      set({ appInfoStatus: 'loading' })
      try {
        const appInfo = await api.getAppInfo()
        set({ appInfo, appInfoStatus: 'ready' })
      } catch {
        set({ appInfoStatus: 'error' })
      }
    },
  }))
}
