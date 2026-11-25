import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { createAppStore } from '../stores/app-store'
import { createIconCache } from '../lib/icon-cache'
import { IconCacheProvider } from '../lib/icon-cache-context'
import { AppStoreProvider } from '../stores/app-store-context'
import { createWorkspaceStore } from '../stores/workspace-store'
import { WorkspaceStoreProvider } from '../stores/workspace-store-context'
import { createFakeApi, type FakeApi } from './fake-api'

/** Renders `ui` inside both store providers, backed by a fake bridge. */
export function renderWithStores(ui: ReactElement, api: FakeApi = createFakeApi()) {
  const appStore = createAppStore(api)
  const workspace = createWorkspaceStore(api)
  const icons = createIconCache({ getIcons: api.getIcons })
  const result = render(
    <AppStoreProvider store={appStore}>
      <WorkspaceStoreProvider store={workspace}>
        <IconCacheProvider cache={icons}>{ui}</IconCacheProvider>
      </WorkspaceStoreProvider>
    </AppStoreProvider>,
  )
  return { ...result, api, appStore, workspace, icons }
}
