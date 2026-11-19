import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import type { StorageIQApi } from '../src/shared/ipc-contract'
import type { ScanDone } from '../src/shared/scan-types'
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
  await expect(
    page.getByRole('heading', { level: 1, name: 'See what’s filling your disk' }),
  ).toBeVisible()

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
    'getAppInfo',
    'listDrives',
    'onScanDone',
    'onScanFailed',
    'onScanProgress',
    'selectFolder',
    'startScan',
  ])
})

test('shows the version reported by the main process', async () => {
  const version = await app!.evaluate(({ app: electronApp }) => electronApp.getVersion())
  await expect(
    page.getByRole('contentinfo').getByText(`StorageIQ ${version}`, { exact: true }),
  ).toBeVisible()
})

test('shows the folder chosen in the native picker', async () => {
  await app!.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: ['C:\\StorageIQ-e2e'],
    })) as typeof dialog.showOpenDialog
  })

  await page.getByRole('button', { name: 'Choose folder' }).click()

  await expect(page.getByText('Selected folder')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText('C:\\StorageIQ-e2e')
  await expect(page.getByRole('button', { name: 'Choose a different folder' })).toBeVisible()
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

test('scans a folder through the bridge in the scanner process', async () => {
  const fixture = createScanFixture()
  try {
    const done = await page.evaluate((root) => {
      const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
      return new Promise<ScanDone>((resolve, reject) => {
        const off = api.onScanDone((result) => {
          off()
          resolve(result)
        })
        api.startScan(root).catch(reject)
      })
    }, fixture.root)

    expect(done).toMatchObject({
      status: 'complete',
      files: fixture.expected.files,
      folders: fixture.expected.folders,
      bytes: fixture.expected.bytes,
      errorCount: 0,
    })
    expect(done.topFolders.map((row) => row.name)).toEqual([
      ...fixture.expected.topFolderNames,
      'Everything else',
    ])
  } finally {
    fixture.remove()
  }
})

test('rejects a relative scan path before the scanner sees it', async () => {
  const outcome = await page.evaluate(async () => {
    const api = (globalThis as unknown as { storageiq: StorageIQApi }).storageiq
    try {
      await api.startScan('relative\\folder')
      return 'resolved'
    } catch (error) {
      return String(error)
    }
  })
  expect(outcome).toContain('Invalid IPC arguments')
})

test('lists the system drive through koffi', async () => {
  const systemRoot = `${process.env['SystemDrive'] ?? 'C:'}\\`
  const drives = await page.evaluate(() =>
    (globalThis as unknown as { storageiq: StorageIQApi }).storageiq.listDrives(),
  )
  expect(drives).toContainEqual(expect.objectContaining({ root: systemRoot, kind: 'fixed' }))
  for (const drive of drives) expect(['fixed', 'removable']).toContain(drive.kind)
})
