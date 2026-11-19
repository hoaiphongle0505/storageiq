import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
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
    'getAppInfo',
    'onScanDone',
    'onScanFailed',
    'onScanProgress',
    'selectFolder',
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
