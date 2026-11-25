import { createContext, type ReactNode, useContext } from 'react'
import { useStore } from 'zustand'
import type { WorkspaceState, WorkspaceStore } from './workspace-store'

const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null)

export function WorkspaceStoreProvider({
  store,
  children,
}: {
  store: WorkspaceStore
  children: ReactNode
}) {
  return <WorkspaceStoreContext.Provider value={store}>{children}</WorkspaceStoreContext.Provider>
}

/**
 * Subscribe to a slice of the workspace store. The selector must return a primitive or a stable
 * reference; returning a fresh object or array every call makes React re-render in a loop.
 */
export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  const store = useContext(WorkspaceStoreContext)
  if (!store) {
    throw new Error('useWorkspace must be used inside <WorkspaceStoreProvider>')
  }
  return useStore(store, selector)
}

/** The store itself, for event handlers that read the latest state without subscribing. */
export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(WorkspaceStoreContext)
  if (!store) {
    throw new Error('useWorkspace must be used inside <WorkspaceStoreProvider>')
  }
  return store
}
