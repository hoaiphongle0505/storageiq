import { createStore, type StoreApi } from 'zustand/vanilla'
import type { StorageIQApi } from '@shared/ipc-contract'
import type {
  DriveInfo,
  ScanDone,
  ScanFailed,
  ScanProgress,
  ScanStartResult,
} from '@shared/scan-types'
import type { LoadStatus } from './app-store'

/** `idle → scanning → done | canceled | failed`; any end state can scan again. */
export type ScanPhase = 'idle' | 'scanning' | 'done' | 'canceled' | 'failed'

export interface ScanState {
  phase: ScanPhase
  drives: DriveInfo[]
  drivesStatus: LoadStatus
  /** The drive root or folder being scanned, or scanned last. */
  target: string | null
  /** Known once `scan:start` returns. */
  scanId: string | null
  progress: ScanProgress | null
  result: ScanDone | null
  folderPickerOpen: boolean
  /** Plain-language problem shown on the pick-location screen. */
  errorMessage: string | null
  loadDrives(): Promise<void>
  chooseFolder(): Promise<void>
  startScan(target: string): Promise<void>
  cancelScan(): Promise<void>
  /** "Scan again" and "Retry": scan the same location again. */
  rescan(): Promise<void>
  /** "Choose another location": back to the pick-location screen. */
  chooseAnotherLocation(): void
  dismissError(): void
}

export type ScanStore = StoreApi<ScanState> & { dispose(): void }

export const FOLDER_PICKER_ERROR = 'StorageIQ couldn’t open the folder picker. Please try again.'
export const START_SCAN_ERROR =
  'StorageIQ couldn’t start a scan of that location. Please choose another one.'
export const NETWORK_PATH_ERROR =
  'StorageIQ can’t scan network locations. Please choose a drive or a folder on this PC.'
export const DRIVES_ERROR = 'StorageIQ couldn’t list your drives. You can still choose a folder.'

type ScanEvent =
  | { kind: 'progress'; payload: ScanProgress }
  | { kind: 'done'; payload: ScanDone }
  | { kind: 'failed'; payload: ScanFailed }

export function isNetworkPath(target: string): boolean {
  return target.startsWith('\\\\') || target.startsWith('//')
}

export function createScanStore(api: StorageIQApi): ScanStore {
  /** Events that arrived while `scan:start` was still in flight (scan ID not known yet). */
  let early: ScanEvent[] = []
  let cancelWhenStarted = false

  const store = createStore<ScanState>()((set, get) => ({
    phase: 'idle',
    drives: [],
    drivesStatus: 'idle',
    target: null,
    scanId: null,
    progress: null,
    result: null,
    folderPickerOpen: false,
    errorMessage: null,

    async loadDrives() {
      if (get().drivesStatus === 'loading') return
      set({ drivesStatus: 'loading' })
      try {
        const drives = await api.listDrives()
        set({ drives, drivesStatus: 'ready' })
      } catch {
        set({ drivesStatus: 'error' })
      }
    },

    async chooseFolder() {
      if (get().folderPickerOpen) return
      set({ folderPickerOpen: true, errorMessage: null })
      let picked: string | null
      try {
        const result = await api.selectFolder()
        picked = result.canceled ? null : result.path
      } catch {
        set({ folderPickerOpen: false, errorMessage: FOLDER_PICKER_ERROR })
        return
      }
      set({ folderPickerOpen: false })
      if (picked !== null) await get().startScan(picked)
    },

    async startScan(target) {
      if (get().phase === 'scanning') return
      if (isNetworkPath(target)) {
        set({ errorMessage: NETWORK_PATH_ERROR })
        return
      }
      early = []
      cancelWhenStarted = false
      set({
        phase: 'scanning',
        target,
        scanId: null,
        progress: null,
        result: null,
        errorMessage: null,
      })
      let started: ScanStartResult
      try {
        started = await api.startScan(target)
      } catch {
        set({ phase: 'idle', errorMessage: START_SCAN_ERROR })
        return
      }
      set({ scanId: started.scanId })
      const pending = early
      early = []
      for (const event of pending) applyEvent(event)
      if (cancelWhenStarted && get().phase === 'scanning') {
        await api.cancelScan(started.scanId).catch(() => undefined)
      }
    },

    async cancelScan() {
      const { phase, scanId } = get()
      if (phase !== 'scanning') return
      if (scanId === null) {
        cancelWhenStarted = true
        return
      }
      try {
        await api.cancelScan(scanId)
      } catch {
        // The scan goes on; its done or failed event still arrives.
      }
    },

    async rescan() {
      const { target } = get()
      if (target !== null) await get().startScan(target)
    },

    chooseAnotherLocation() {
      if (get().phase === 'scanning') return
      set({ phase: 'idle', scanId: null, progress: null, result: null, errorMessage: null })
    },

    dismissError() {
      set({ errorMessage: null })
    },
  }))

  function applyEvent(event: ScanEvent): void {
    const { phase, scanId } = store.getState()
    if (phase !== 'scanning') return
    if (scanId === null) {
      early.push(event)
      return
    }
    if (event.payload.scanId !== scanId) return
    if (event.kind === 'progress') {
      store.setState({ progress: event.payload })
    } else if (event.kind === 'done') {
      store.setState({
        phase: event.payload.status === 'complete' ? 'done' : 'canceled',
        result: event.payload,
        progress: null,
      })
    } else {
      store.setState({ phase: 'failed', progress: null })
    }
  }

  const unsubscribers = [
    api.onScanProgress((payload) => applyEvent({ kind: 'progress', payload })),
    api.onScanDone((payload) => applyEvent({ kind: 'done', payload })),
    api.onScanFailed((payload) => applyEvent({ kind: 'failed', payload })),
  ]

  return Object.assign(store, {
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe()
    },
  })
}
