import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { consoleErrors, cspListenerReady, launchApp } from './support/launch'
import { ribbonButton } from './support/workspace'

let app: ElectronApplication | undefined
let page: Page

test.beforeEach(async () => {
  const launched = await launchApp()
  app = launched.app
  page = launched.page
  await page.getByRole('tab', { name: 'Help' }).click()
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
})

test('About opens from the Help tab, shows the version and the logo, and closes with Escape', async () => {
  const version = await app!.evaluate(({ app: electronApp }) => electronApp.getVersion())
  await ribbonButton(page, 'About').click()
  const dialog = page.getByRole('dialog', { name: 'About StorageIQ' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(`Version ${version}`)
  await expect(dialog.locator('svg[viewBox="0 0 64 64"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(ribbonButton(page, 'About')).toBeFocused()
})

test('Check for updates in an unpackaged app shows “Updates are available in the installed app.” and makes no network request', async () => {
  const requests: string[] = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  await ribbonButton(page, 'Check for updates').click()
  const dialog = page.getByRole('dialog', { name: 'About StorageIQ' })
  await expect(dialog.getByRole('status')).toContainText(
    'Updates are available in the installed app.',
  )
  expect(requests).toEqual([])
})

test('What’s new lists the CHANGELOG entry 0.2.0-beta.1 with its sections', async () => {
  await ribbonButton(page, /^What.s new/).click()
  const dialog = page.getByRole('dialog', { name: /^What.s new/ })
  await expect(
    dialog.getByRole('heading', { level: 3, name: /^Version 0\.2\.0-beta\.1/ }),
  ).toBeVisible()
  for (const section of ['Added', 'Changed', 'Fixed']) {
    await expect(dialog.getByRole('heading', { level: 4, name: section }).first()).toBeVisible()
  }
})

test('the Help tab has Help, Report a problem, About, Check for updates and What’s new buttons', async () => {
  for (const name of ['Help', 'Report a problem', 'About', 'Check for updates', /^What.s new/]) {
    await expect(ribbonButton(page, name)).toBeVisible()
  }
})

test('no console or CSP errors while About and What’s new are open', async () => {
  await expect.poll(() => cspListenerReady(app!)).toBe(true)
  await ribbonButton(page, 'About').click()
  const about = page.getByRole('dialog', { name: 'About StorageIQ' })
  await expect(about).toBeVisible()
  await about.getByRole('button', { name: /^What.s new/ }).click()
  await expect(page.getByRole('dialog', { name: /^What.s new/ })).toBeVisible()
  expect(await consoleErrors(app!)).toEqual([])
})
