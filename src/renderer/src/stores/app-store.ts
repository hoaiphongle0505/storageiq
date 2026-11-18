import { createStore, type StoreApi } from 'zustand/vanilla'
import type { AppInfo, StorageIQApi } from '@shared/ipc-contract'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AppState {
  appInfo: AppInfo | null
  appInfoStatus: LoadStatus
  /** Folder the user chose; Phase 2 scans it. */
  scanTarget: string | null
  folderPickerOpen: boolean
  errorMessage: string | null
  loadAppInfo(): Promise<void>
  chooseFolder(): Promise<void>
  dismissError(): void
}

export type AppStore = StoreApi<AppState>

const FOLDER_PICKER_ERROR = 'StorageIQ couldn’t open the folder picker. Please try again.'

export function createAppStore(api: StorageIQApi): AppStore {
  return createStore<AppState>()((set, get) => ({
    appInfo: null,
    appInfoStatus: 'idle',
    scanTarget: null,
    folderPickerOpen: false,
    errorMessage: null,

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

    async chooseFolder() {
      if (get().folderPickerOpen) return
      set({ folderPickerOpen: true, errorMessage: null })
      try {
        const result = await api.selectFolder()
        set(
          result.canceled
            ? { folderPickerOpen: false }
            : { folderPickerOpen: false, scanTarget: result.path },
        )
      } catch {
        set({ folderPickerOpen: false, errorMessage: FOLDER_PICKER_ERROR })
      }
    },

    dismissError() {
      set({ errorMessage: null })
    },
  }))
}
