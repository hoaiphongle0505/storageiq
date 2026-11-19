import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createAppStore } from '../stores/app-store'
import { AppStoreProvider } from '../stores/app-store-context'
import { createScanStore } from '../stores/scan-store'
import { ScanStoreProvider } from '../stores/scan-store-context'
import { createFakeApi, type FakeApi } from './fake-api'

/** Renders `ui` inside both store providers, backed by a fake bridge. */
export function renderWithStores(ui: ReactElement, api: FakeApi = createFakeApi()) {
  const appStore = createAppStore(api)
  const scanStore = createScanStore(api)
  const result = render(
    <AppStoreProvider store={appStore}>
      <ScanStoreProvider store={scanStore}>{ui}</ScanStoreProvider>
    </AppStoreProvider>,
  )
  return { ...result, api, appStore, scanStore }
}
