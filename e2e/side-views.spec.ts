import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { allocated, createScanFixture, type ScanFixture } from './support/fixture'
import { consoleErrors, launchApp } from './support/launch'
import {
  cellBytes,
  count,
  driveDetails,
  ribbonButton,
  scanFolder,
  treeRow,
} from './support/workspace'

let app: ElectronApplication | undefined
let page: Page
let fixture: ScanFixture | undefined

test.beforeEach(async () => {
  const launched = await launchApp()
  app = launched.app
  page = launched.page
})

test.afterEach(async () => {
  await app?.close()
  app = undefined
  fixture?.remove()
  fixture = undefined
})

async function scanFixture(): Promise<{ fixture: ScanFixture; cluster: number }> {
  fixture = createScanFixture()
  const details = await driveDetails(page, `${fixture.root.slice(0, 2)}\\`)
  expect(details).not.toBeNull()
  await scanFolder(app!, page, fixture.root)
  return { fixture, cluster: details!.clusterBytes }
}

const tab = (name: string) => page.getByRole('tab', { name, exact: true })
const readClipboard = () => app!.evaluate(({ clipboard }) => clipboard.readText())

test('the bottom pane has four tabs, and the View tab follows them', async () => {
  await scanFixture()
  await expect(page.getByRole('tablist', { name: 'Pane views' }).getByRole('tab')).toHaveText([
    'Treemap',
    'Top files',
    'Types',
    'Age',
  ])
  await expect(tab('Treemap')).toHaveAttribute('aria-selected', 'true')
  await tab('Top files').click()
  await expect(page.getByRole('region', { name: 'Top files' })).toBeVisible()
  await expect(page.getByRole('toolbar', { name: 'Treemap levels' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'View' }).click()
  await expect(ribbonButton(page, 'Top files')).toHaveAttribute('aria-pressed', 'true')
  await ribbonButton(page, 'Age').click()
  await expect(page.getByRole('region', { name: 'Age' })).toBeVisible()
  await ribbonButton(page, 'Age').click()
  await expect(page.getByRole('region', { name: 'Age' })).toHaveCount(0)
  await ribbonButton(page, 'Treemap').click()
  await expect(page.getByRole('region', { name: 'Treemap' })).toBeVisible()
  expect(await consoleErrors(app!)).toEqual([])
})

test('Top files lists the largest files first and reveals one in the tree', async () => {
  const { fixture: f } = await scanFixture()
  await tab('Top files').click()
  const grid = page.getByRole('grid', { name: 'Largest files' })
  // 62 files and the junction's 0-byte entry are all listed; the header is row 1.
  await expect(grid).toHaveAttribute('aria-rowcount', String(f.expected.files + 1))
  const rows = grid.getByRole('row')
  const top = rows.nth(1)
  // folder-12 holds the biggest files (12,000 bytes each); which of its five comes first depends
  // on the walk order, so the test checks the size and the folder, not the name.
  expect(await cellBytes(top, 1)).toBe(12_000)
  await expect(top.getByRole('gridcell').nth(4)).toHaveAttribute('title', /folder-12/)
  const sizes = await rows.evaluateAll((all) =>
    all
      .slice(1)
      .map((row) =>
        Number(row.querySelectorAll('[role="gridcell"]')[1]?.getAttribute('data-bytes')),
      ),
  )
  expect([...sizes].sort((a, b) => b - a)).toEqual(sizes)

  const name = (await top.getByRole('gridcell').first().textContent()) ?? ''
  await top.dblclick()
  await expect(treeRow(page, name)).toHaveAttribute('aria-selected', 'true')
})

test('Types sums every file by extension, and Age puts the new files in the last 30 days', async () => {
  const { fixture: f, cluster } = await scanFixture()
  await tab('Types').click()
  const types = page.getByRole('table', { name: 'File types in this folder' })
  const txt = types.getByRole('row').filter({ hasText: '.txt' })
  await expect(txt.getByRole('cell').nth(1)).toHaveText('Documents')
  await expect(txt.getByRole('cell').nth(2)).toHaveAttribute('title', '777 bytes')
  await expect(txt.getByRole('cell').nth(3)).toHaveAttribute(
    'title',
    `${count.format(allocated([777], cluster))} bytes`,
  )
  await expect(txt.getByRole('cell').nth(4)).toHaveText('1')
  const files = await types
    .getByRole('row')
    .evaluateAll((all) =>
      all
        .slice(1)
        .map((row) => Number(row.querySelectorAll('td')[4]?.textContent?.replaceAll(',', ''))),
    )
  expect(files.reduce((sum, value) => sum + value, 0)).toBe(f.expected.files)

  await tab('Age').click()
  const age = page.getByRole('table', { name: 'File age in this folder' })
  await expect(age.getByRole('row')).toHaveCount(9)
  const recent = age.getByRole('row').filter({ hasText: 'Last 30 days' })
  await expect(recent.getByRole('cell').nth(2)).toHaveText(count.format(f.expected.files))
  await expect(recent.getByRole('cell').nth(3)).toHaveText('100.0%')
})

test('Copy as CSV puts the whole list on the clipboard through main', async () => {
  const { fixture: f, cluster } = await scanFixture()
  await tab('Types').click()
  await page.getByRole('button', { name: 'Copy as CSV' }).click()
  await expect
    .poll(readClipboard)
    .toContain('Extension,Category,Size (bytes),Allocated (bytes),Files\r\n')
  const types = await readClipboard()
  expect(types).toContain(`.txt,Documents,777,${allocated([777], cluster)},1\r\n`)

  await tab('Top files').click()
  await page.getByRole('button', { name: 'Copy as CSV' }).click()
  await expect
    .poll(async () => (await readClipboard()).startsWith('Name,Folder,Size (bytes),'))
    .toBe(true)
  const lines = (await readClipboard()).trimEnd().split('\r\n')
  expect(lines).toHaveLength(f.expected.files + 1)
  expect(lines[1]).toMatch(/^file-\d\.[a-z0-9]+,.*folder-12.*,12000,/)
  expect(await consoleErrors(app!)).toEqual([])
})
