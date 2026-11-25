import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import type { StorageIQApi } from '../src/shared/ipc-contract'
import type { ScanDone } from '../src/shared/scan-types'
import type { TreePage } from '../src/shared/tree-types'
import { createScanFixture } from './support/fixture'
import { consoleErrors, cspListenerReady, launchApp } from './support/launch'

let app: ElectronApplication | undefined
let page: Page

test.beforeEach(async () => {
  const launched = await launchApp()
  app = launched.app
  page = launched.page
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
})

test('launches a locked-down renderer with the StorageIQ bridge', async () => {
  await expect(page).toHaveTitle('StorageIQ')
  await expect(page.getByRole('tablist', { name: 'Ribbon' })).toBeVisible()

  const exposure = await page.evaluate(() => {
    const scope = globalThis as unknown as Record<string, unknown>
    return {
      require: typeof scope['require'],
      process: typeof scope['process'],
      storageiq: typeof scope['storageiq'],
    }
  })
  expect(exposure).toEqual({ require: 'undefined', process: 'undefined', storageiq: 'object' })

  const keys = await page.evaluate(() =>
    Object.keys((globalThis as unknown as { storageiq: object }).storageiq).sort(),
  )
  expect(keys).toEqual([
    'cancelScan',
    'checkForUpdates',
    'copyNodePath',
    'createFolder',
    'deleteNodes',
    'downloadUpdate',
    'getAppInfo',
    'getAutoUpdate',
    'getChangelog',
    'getChildren',
    'getDriveInfo',
    'getExpandIds',
    'getIcons',
    'getNode',
    'getOptionsState',
    'getReleaseNotes',
    'getTreemap',
    'getTypeIcons',
    'getUpdateState',
    'getWhatsNewDue',
    'installUpdate',
    'listDrives',
    'listPlaces',
    'markWhatsNewSeen',
    'onLaunchRequest',
    'onScanDone',
    'onScanFailed',
    'onScanProgress',
    'onScanRestarted',
    'onTreeChanged',
    'onUpdateState',
    'openInExplorer',
    'openLink',
    'openNotices',
    'quit',
    'refreshFolder',
    'selectFolder',
    'setAutoUpdate',
    'setExplorerMenu',
    'setRunAsAdmin',
    'showContextMenu',
    'startScan',
    'takeLaunchRequest',
  ])
})

test('shows the version reported by the main process', async () => {
  const version = await app!.evaluate(({ app: electronApp }) => electronApp.getVersion())
  await expect(
    page.getByRole('contentinfo').getByText(`StorageIQ ${version}`, { exact: true }),
  ).toBeVisible()
})

test('logs no console errors or CSP violations from the first page load on', async () => {
  await expect.poll(() => cspListenerReady(app!)).toBe(true)
  await expect(page.getByRole('contentinfo').getByText(/^StorageIQ \d/)).toBeVisible()
  expect(await consoleErrors(app!)).toEqual([])
})

test('the listeners really catch a CSP violation', async () => {
  // A remote script is blocked by `script-src 'self'`; the hook must report it.
  await page.addScriptTag({ url: 'https://example.invalid/blocked.js' }).catch(() => undefined)
  await expect
    .poll(() => consoleErrors(app!))
    .toContainEqual(expect.stringContaining('[csp] script-src'))
})

test('scans a folder through the bridge and pages its children from the scanner', async () => {
  const fixture = createScanFixture()
  try {
    const result = await page.evaluate(async (root) => {
      const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
      const done = await new Promise<ScanDone>((resolve, reject) => {
        const off = api.onScanDone((value) => {
          off()
          resolve(value)
        })
        api.startScan(root).catch(reject)
      })
      const page: TreePage | null = await api.getChildren(done.scanId, 'd0', 'name', 'asc', 0, 5)
      return { done, page }
    }, fixture.root)

    expect(result.done).toMatchObject({
      status: 'complete',
      files: fixture.expected.files,
      folders: fixture.expected.folders,
      bytes: fixture.expected.bytes,
      errorCount: 0,
    })
    // The parallel walker pool is the default (at least one walker ran).
    expect(result.done.walkers).toBeGreaterThanOrEqual(1)
    expect(result.page?.total).toBe(13)
    expect(result.page?.rows.map((row) => row.name || '[files]')).toEqual([
      '[files]',
      'folder-01',
      'folder-02',
      'folder-03',
      'folder-04',
    ])
  } finally {
    fixture.remove()
  }
})

test('rejects a relative scan path and a malformed tree query before the scanner sees them', async () => {
  const outcome = await page.evaluate(async () => {
    const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
    const attempt = async (call: () => Promise<unknown>) => {
      try {
        await call()
        return 'resolved'
      } catch (error) {
        return String(error)
      }
    }
    return {
      relative: await attempt(() => api.startScan('relative\\folder')),
      node: await attempt(() => api.getChildren('scan', '../../etc', 'size', 'desc', 0, 10)),
      limit: await attempt(() => api.getChildren('scan', 'd0', 'size', 'desc', 0, 1_000_000)),
    }
  })
  expect(outcome.relative).toContain('Invalid IPC arguments')
  expect(outcome.node).toContain('Invalid IPC arguments')
  expect(outcome.limit).toContain('Invalid IPC arguments')
})

test('opens in Explorer and copies only paths of the current scan', async () => {
  const outcome = await page.evaluate(async () => {
    const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
    const stale = '00000000-0000-0000-0000-000000000000'
    const attempt = async (call: () => Promise<unknown>) => {
      try {
        await call()
        return 'resolved'
      } catch (error) {
        return String(error)
      }
    }
    return {
      open: await attempt(() => api.openInExplorer(stale, 'd0')),
      copy: await attempt(() => api.copyNodePath(stale, ['d0'])),
    }
  })
  expect(outcome.open).toContain('not part of the current scan')
  expect(outcome.copy).toContain('not part of the current scan')
})

test('lists the system drive and reads its cluster size through koffi', async () => {
  const systemRoot = `${process.env['SystemDrive'] ?? 'C:'}\\`
  const { drives, details } = await page.evaluate(async (root) => {
    const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
    return { drives: await api.listDrives(), details: await api.getDriveInfo(root) }
  }, systemRoot)
  expect(drives).toContainEqual(expect.objectContaining({ root: systemRoot, kind: 'fixed' }))
  for (const drive of drives) expect(['fixed', 'removable']).toContain(drive.kind)
  expect(details).toMatchObject({ root: systemRoot, fileSystem: 'NTFS' })
  expect(details?.clusterBytes).toBeGreaterThanOrEqual(512)
})

test('quits cleanly when closed while the first page is still loading', async () => {
  // Quitting aborts the in-flight load; that must not raise the modal startup-error box.
  await app!.close()
  app = undefined
})
