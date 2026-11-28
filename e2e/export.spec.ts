import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { createScanFixture, type ScanFixture } from './support/fixture'
import { consoleErrors, launchApp } from './support/launch'
import { ribbonButton, scanFolder, stubSaveDialog } from './support/workspace'
import { zipFiles } from './support/zip'

let app: ElectronApplication | undefined
let page: Page
let fixture: ScanFixture | undefined
let outDir = ''

test.beforeEach(async () => {
  const launched = await launchApp()
  app = launched.app
  page = launched.page
  outDir = mkdtempSync(path.join(os.tmpdir(), 'storageiq-e2e-export-'))
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
  fixture?.remove()
  fixture = undefined
  rmSync(outDir, { recursive: true, force: true })
})

async function scanFixture(): Promise<ScanFixture> {
  fixture = createScanFixture()
  await page.getByRole('tab', { name: 'Home', exact: true }).click()
  await scanFolder(app!, page, fixture.root)
  return fixture
}

const openFileTab = () => page.getByRole('tab', { name: 'File', exact: true }).click()
const tab = (name: string) => page.getByRole('tab', { name, exact: true })
/** The calm confirmation above the tree (the status bar repeats it for screen readers). */
const doneBanner = () =>
  page
    .locator('[role="status"]')
    .filter({ has: page.getByRole('button', { name: 'Show in folder' }) })

test('Export waits for a finished scan', async () => {
  await openFileTab()
  await expect(ribbonButton(page, 'Export to CSV…')).toHaveAttribute('aria-disabled', 'true')
  await expect(ribbonButton(page, 'Export to Excel…')).toHaveAttribute('aria-disabled', 'true')
  await scanFixture()
  await openFileTab()
  await expect(ribbonButton(page, 'Export to CSV…')).not.toHaveAttribute('aria-disabled', 'true')
  await expect(ribbonButton(page, 'Export to Excel…')).not.toHaveAttribute('aria-disabled', 'true')
})

test('Export to CSV writes every folder and file, biggest first, and says so', async () => {
  const f = await scanFixture()
  const file = path.join(outDir, 'tree.csv')
  await stubSaveDialog(app!, file)
  await openFileTab()
  await ribbonButton(page, 'Export to CSV…').click()

  // 24 folders and 62 files (the junction is one 0-byte file) below the scan root.
  const rows = f.expected.folders + f.expected.files
  await expect(doneBanner()).toContainText(`Exported ${rows} rows to tree.csv.`)
  await expect(page.getByRole('button', { name: 'Show in folder' })).toBeVisible()

  const text = readFileSync(file, 'utf8')
  expect(text.startsWith('﻿Path,Name,Type,Extension,Size (bytes),Allocated (bytes),')).toBe(true)
  const lines = text.slice(1).split('\r\n')
  expect(lines).toHaveLength(1 + rows + 1)
  // folder-12 is the biggest folder: 5 files of 12,000 bytes.
  expect(lines[1]).toMatch(
    new RegExp(
      `^${f.root.replaceAll('\\', '\\\\')}\\\\folder-12,folder-12,Folder,,60000,\\d+,5,1,`,
    ),
  )
  expect(await consoleErrors(app!)).toEqual([])
})

test('Export to Excel writes a workbook of four sheets', async () => {
  const f = await scanFixture()
  const file = path.join(outDir, 'tree.xlsx')
  await stubSaveDialog(app!, file)
  await openFileTab()
  await ribbonButton(page, 'Export to Excel…').click()
  const rows = f.expected.folders + f.expected.files
  await expect(doneBanner()).toContainText(`Exported ${rows} rows to tree.xlsx.`)

  const files = zipFiles(readFileSync(file))
  const workbook = files.get('xl/workbook.xml') ?? ''
  expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map((match) => match[1])).toEqual([
    'Tree',
    'Top files',
    'Types',
    'Age',
  ])
  for (const n of [1, 2, 3, 4]) expect(files.has(`xl/worksheets/sheet${n}.xml`)).toBe(true)
  expect(files.get('xl/worksheets/sheet1.xml')?.match(/<row /g)).toHaveLength(1 + rows)
  expect(files.get('xl/worksheets/sheet2.xml')?.match(/<row /g)).toHaveLength(1 + f.expected.files)
  expect(files.get('xl/worksheets/sheet4.xml')?.match(/<row /g)).toHaveLength(1 + 8)
  expect(await consoleErrors(app!)).toEqual([])
})

test('a cancelled save dialog writes nothing and shows no banner', async () => {
  await scanFixture()
  await stubSaveDialog(app!, null)
  await openFileTab()
  await ribbonButton(page, 'Export to CSV…').click()
  await expect(ribbonButton(page, 'Export to CSV…')).not.toHaveAttribute('aria-disabled', 'true')
  await expect(doneBanner()).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(existsSync(path.join(outDir, 'tree.csv'))).toBe(false)
})

test('a file that cannot be written shows the error and leaves Export usable', async () => {
  await scanFixture()
  await stubSaveDialog(app!, path.join(outDir, 'missing-folder', 'tree.csv'))
  await openFileTab()
  await ribbonButton(page, 'Export to CSV…').click()
  await expect(page.getByRole('alert')).toContainText('Couldn’t export the tree.')
  await expect(ribbonButton(page, 'Export to CSV…')).not.toHaveAttribute('aria-disabled', 'true')
})

test('Types and Age show a chart that the Chart button hides', async () => {
  await scanFixture()
  await tab('Types').click()
  const pie = page.getByRole('img', { name: /^Space by file type: / })
  await expect(pie).toBeVisible()
  await expect(pie).toHaveAccessibleName(/\d+ %, .* \d+ %/)
  await expect(
    page.getByRole('list', { name: 'File types by size' }).getByRole('listitem'),
  ).not.toHaveCount(0)
  await page.getByRole('button', { name: 'Chart', exact: true }).click()
  await expect(pie).toHaveCount(0)
  await expect(page.getByRole('table', { name: 'File types in this folder' })).toBeVisible()

  await tab('Age').click()
  await expect(
    page.getByRole('img', { name: /^Space by file age: Last 30 days 100 %/ }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Chart', exact: true }).click()
  await expect(
    page.getByRole('img', { name: /^Space by file age: Last 30 days 100 %/ }),
  ).toBeVisible()
  expect(await consoleErrors(app!)).toEqual([])
})
