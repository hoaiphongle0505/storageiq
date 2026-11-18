import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createAppStore } from './stores/app-store'
import { AppStoreProvider } from './stores/app-store-context'
import './styles/global.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('StorageIQ: #root element is missing from index.html')
}

const store = createAppStore(window.storageiq)

createRoot(container).render(
  <StrictMode>
    <AppStoreProvider store={store}>
      <App />
    </AppStoreProvider>
  </StrictMode>,
)
