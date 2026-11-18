import { vi } from 'vitest'
import type { AppInfo, SelectFolderResult, StorageIQApi } from '@shared/ipc-contract'

export const TEST_APP_INFO: AppInfo = {
  name: 'StorageIQ',
  version: '0.1.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '38.0.0',
}

export function createFakeApi(overrides: Partial<StorageIQApi> = {}): StorageIQApi {
  return {
    getAppInfo: vi.fn(async () => TEST_APP_INFO),
    selectFolder: vi.fn(async (): Promise<SelectFolderResult> => ({ canceled: true })),
    ...overrides,
  }
}
