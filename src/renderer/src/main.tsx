import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createAppStore } from './stores/app-store'
import { AppStoreProvider } from './stores/app-store-context'
import { createScanStore } from './stores/scan-store'
import { ScanStoreProvider } from './stores/scan-store-context'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('StorageIQ: #root element is missing from index.html')
}

if (window.storageiq === undefined) {
  throw new Error('StorageIQ: the preload bridge is missing')
}

const appStore = createAppStore(window.storageiq)
const scanStore = createScanStore(window.storageiq)

createRoot(container).render(
  <StrictMode>
    <AppStoreProvider store={appStore}>
      <ScanStoreProvider store={scanStore}>
        <App />
      </ScanStoreProvider>
    </AppStoreProvider>
  </StrictMode>,
)
