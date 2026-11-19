import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'
import type { ScanState, ScanStore } from './scan-store'

const ScanStoreContext = createContext<ScanStore | null>(null)

export function ScanStoreProvider({ store, children }: { store: ScanStore; children: ReactNode }) {
  return <ScanStoreContext.Provider value={store}>{children}</ScanStoreContext.Provider>
}

/**
 * Subscribe to a slice of the scan store. The selector must return a primitive or a stable
 * reference; returning a fresh object or array every call makes React re-render in a loop.
 */
export function useScanStore<T>(selector: (state: ScanState) => T): T {
  const store = useContext(ScanStoreContext)
  if (!store) {
    throw new Error('useScanStore must be used inside <ScanStoreProvider>')
  }
  return useStore(store, selector)
}
