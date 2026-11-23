import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createIconCache } from './lib/icon-cache'
import { IconCacheProvider } from './lib/icon-cache-context'
import { createAppStore } from './stores/app-store'
import { AppStoreProvider } from './stores/app-store-context'
import { createWorkspaceStore } from './stores/workspace-store'
import { WorkspaceStoreProvider } from './stores/workspace-store-context'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('StorageIQ: #root element is missing from index.html')
}

if (window.storageiq === undefined) {
  throw new Error('StorageIQ: the preload bridge is missing')
}

const appStore = createAppStore(window.storageiq)
const workspaceStore = createWorkspaceStore(window.storageiq)
const iconCache = createIconCache({ getIcons: window.storageiq.getIcons })

createRoot(container).render(
  <StrictMode>
    <AppStoreProvider store={appStore}>
      <WorkspaceStoreProvider store={workspaceStore}>
        <IconCacheProvider cache={iconCache}>
          <App />
        </IconCacheProvider>
      </WorkspaceStoreProvider>
    </AppStoreProvider>
  </StrictMode>,
)
