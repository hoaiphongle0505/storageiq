import { type ElectronApplication, expect, type Locator, type Page, test } from '@playwright/test'
import { SCANNER_SERVICE_NAME } from '../src/shared/scanner-protocol'
import { createScanFixture } from './support/fixture'
import { consoleErrors, launchApp } from './support/launch'

let app: ElectronApplication | undefined
let page: Page

const count = new Intl.NumberFormat('en-US')
const systemDrive = process.env['SystemDrive'] ?? 'C:'
const systemDriveCard = () =>
  page.getByRole('list', { name: 'Drives' }).getByRole('button', {
    name: new RegExp(`\\(${systemDrive}\\)`),
  })

test.beforeEach(async () => {
  const launched = await launchApp()
  app = launched.app
  page = launched.page
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
})

/** The `<dd>` value next to a result/scanning `<dt>` label. */
function stat(label: string): Locator {
  return page
    .getByText(label, { exact: true })
    .and(page.locator('dt'))
    .locator('xpath=following-sibling::dd[1]')
}

async function stubFolderDialog(folder: string): Promise<void> {
  await app!.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [chosen],
    })) as typeof dialog.showOpenDialog
  }, folder)
}

function scannerPid(): Promise<number | undefined> {
  return app!.evaluate(
    ({ app: electronApp }, name) =>
      electronApp.getAppMetrics().find((metric) => metric.name === name)?.pid,
    SCANNER_SERVICE_NAME,
  )
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function startSystemDriveScan(): Promise<void> {
  await systemDriveCard().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Scanning' })).toBeVisible()
}

test('scans a chosen folder and shows exact totals and the largest folders', async () => {
  const fixture = createScanFixture()
  try {
    await stubFolderDialog(fixture.root)
    await page.getByRole('button', { name: 'Choose folder…' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Scan complete' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(stat('Files')).toHaveText(count.format(fixture.expected.files))
    await expect(stat('Folders')).toHaveText(count.format(fixture.expected.folders))
    await expect(stat('Total size')).toHaveAttribute(
      'title',
      `${count.format(fixture.expected.bytes)} bytes`,
    )

    const rows = page.getByRole('region', { name: 'Largest folders' }).getByRole('listitem')
    await expect(rows).toHaveCount(11)
    for (const [index, name] of fixture.expected.topFolderNames.entries()) {
      await expect(rows.nth(index)).toContainText(name)
    }
    await expect(rows.nth(10)).toContainText('Everything else')
    await expect(page.getByText(/couldn’t be read/)).toHaveCount(0)
    expect(await consoleErrors(app!)).toEqual([])
  } finally {
    fixture.remove()
  }
})

test('shows a card for the system drive', async () => {
  await expect(systemDriveCard()).toBeVisible()
})

test('cancels a running scan and shows partial results', async () => {
  await startSystemDriveScan()
  const cancel = page.getByRole('button', { name: 'Cancel' })
  await expect(cancel).toBeFocused()
  await page.waitForTimeout(1_000)

  const clickedAt = Date.now()
  await cancel.click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Scan canceled — partial results' }),
  ).toBeVisible()
  expect(Date.now() - clickedAt).toBeLessThan(2_000)
})

test('shows the crash screen when the scanner process dies', async () => {
  await startSystemDriveScan()
  const pid = await scannerPid()
  expect(pid).toBeDefined()

  process.kill(pid!)

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'The scan stopped unexpectedly. You can try again.',
    }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeFocused()
})

test('quitting during a scan leaves no scanner process behind', async () => {
  await startSystemDriveScan()
  const pid = await scannerPid()
  expect(pid).toBeDefined()

  await app!.close()
  app = undefined

  await expect.poll(() => isAlive(pid!), { timeout: 5_000 }).toBe(false)
})

test('a busy button keeps its colour on hover (roadmap carry-over 8)', async () => {
  await app!.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (() => new Promise(() => undefined)) as typeof dialog.showOpenDialog
  })
  const button = page.getByRole('button', { name: 'Choose folder…' })
  await button.click()
  await expect(button).toHaveAttribute('aria-disabled', 'true')

  const background = () =>
    button.evaluate(
      (element) =>
        (
          globalThis as unknown as {
            getComputedStyle(target: unknown): { backgroundColor: string }
          }
        ).getComputedStyle(element).backgroundColor,
    )
  await page.mouse.move(0, 0)
  const resting = await background()
  await button.hover()
  expect(await background()).toBe(resting)
})
