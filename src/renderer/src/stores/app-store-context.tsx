import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'
import type { AppState, AppStore } from './app-store'

const AppStoreContext = createContext<AppStore | null>(null)

export function AppStoreProvider({ store, children }: { store: AppStore; children: ReactNode }) {
  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>
}

/**
 * Subscribe to a slice of the app store. The selector must return a primitive or a
 * stable reference (or be wrapped in `useShallow` from `zustand/react/shallow`);
 * returning a fresh object or array every call makes React re-render in a loop.
 */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  const store = useContext(AppStoreContext)
  if (!store) {
    throw new Error('useAppStore must be used inside <AppStoreProvider>')
  }
  return useStore(store, selector)
}
