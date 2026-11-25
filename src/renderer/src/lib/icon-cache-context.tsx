import { createContext, type ReactNode, useContext, useSyncExternalStore } from 'react'
import type { IconImage } from '@shared/ipc-contract'
import type { NodeId } from '@shared/tree-types'
import type { IconCache } from './icon-cache'

const IconCacheContext = createContext<IconCache | null>(null)

/** Gives the tree rows the icon cache of this window. Without one every row keeps its placeholder. */
export function IconCacheProvider({ cache, children }: { cache: IconCache; children: ReactNode }) {
  return <IconCacheContext.Provider value={cache}>{children}</IconCacheContext.Provider>
}

/** The icon cache, or null outside a provider (placeholders only). */
export function useIconCache(): IconCache | null {
  return useContext(IconCacheContext)
}

const NEVER = (): (() => void) => () => undefined

/** The Windows icon of a row once it has arrived; `undefined` until then. */
export function useRowIcon(nodeId: NodeId): IconImage | undefined {
  const cache = useIconCache()
  return useSyncExternalStore(
    cache?.subscribe ?? NEVER,
    () => cache?.imageOf(nodeId),
    () => undefined,
  )
}
