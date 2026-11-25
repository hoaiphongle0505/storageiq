import { existsSync } from 'node:fs'
import path from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { SCANNER_SERVICE_NAME } from '../src/shared/scanner-protocol'
import { allocated, createScanFixture, type ScanFixture, sum } from './support/fixture'
import { consoleErrors, launchApp } from './support/launch'
import {
  cellBytes,
  cellTexts,
  count,
  driveDetails,
  openSelectMenu,
  ribbonButton,
  scanFolder,
  treegrid,
  treeRow,
} from './support/workspace'

let app: ElectronApplication | undefined
let page: Page
let fixture: ScanFixture | undefined

const systemDrive = process.env['SystemDrive'] ?? 'C:'

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
  const menu = await openSelectMenu(page)
  await menu.getByRole('menuitem', { name: new RegExp(`\\(${systemDrive}\\)`) }).click()
  await expect(ribbonButton(page, 'Stop')).not.toHaveAttribute('aria-disabled', 'true')
  await expect.poll(scannerPid).toBeDefined()
}

test('opens on the empty workspace', async () => {
  await expect(page.getByRole('tab', { name: 'Home' })).toHaveAttribute('aria-selected', 'true')
  await expect(treegrid(page)).toContainText('Choose a drive or folder from Select')
  await expect(
    page.getByRole('toolbar', { name: 'Treemap levels' }).getByRole('button'),
  ).toHaveCount(6)
  expect(await consoleErrors(app!)).toEqual([])
})

test('arrow keys move focus exactly one item in the toolbar, the tab strip and the Select menu', async () => {
  // Detection check: whichever way focusgroup is provided (native or the fallback), one key
  // press is one step, never two.
  const toolbarButtons = page.getByRole('toolbar', { name: /commands$/ }).getByRole('button')
  expect(await toolbarButtons.count()).toBeGreaterThan(3)
  await toolbarButtons.nth(0).focus()
  await page.keyboard.press('ArrowRight')
  await expect(toolbarButtons.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(toolbarButtons.nth(2)).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(toolbarButtons.nth(1)).toBeFocused()

  const tabs = page.getByRole('tablist', { name: 'Ribbon' }).getByRole('tab')
  await tabs.nth(1).focus() // Home
  await page.keyboard.press('ArrowRight')
  await expect(tabs.nth(2)).toBeFocused()

  await page.getByRole('tab', { name: 'Home' }).click()
  const menu = await openSelectMenu(page)
  const items = menu.getByRole('menuitem')
  await page.keyboard.press('ArrowDown') // from the trigger into the first item
  await expect(items.nth(0)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(items.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(items.nth(0)).toBeFocused()
})

test('the Select menu lists the system drive', async () => {
  const menu = await openSelectMenu(page)
  await expect(menu.getByRole('group', { name: 'Drives' })).toContainText(`(${systemDrive})`)
  await expect(menu.getByRole('menuitem', { name: 'Choose a folder…' })).toBeVisible()
})

test('tree rows render a native icon image', async () => {
  await scanFixture()
  const rows = treegrid(page).getByRole('row')
  await expect(rows.nth(1)).toBeVisible()
  // The icon box exists with its final size before any bitmap arrives; record it now.
  const boxOf = () => treegrid(page).locator('[data-file-icon]').first().boundingBox()
  const before = await boxOf()
  expect(before).not.toBeNull()
  expect(before!.width).toBe(16)
  expect(before!.height).toBe(16)
  const image = treegrid(page).locator('[role="row"] img[data-icon]').first()
  await expect(image).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(() =>
      image.evaluate((element) => (element as unknown as { naturalWidth: number }).naturalWidth),
    )
    .toBeGreaterThan(0)
  expect(await boxOf()).toEqual(before)
})

test('the ribbon shows svg icons and none of the removed icon package’s classes', async () => {
  // The removed package marked its svgs with a class named after itself.
  await expect(page.locator(`.${['luc', 'ide'].join('')}`)).toHaveCount(0)
  const buttons = page.getByRole('toolbar', { name: /commands$/ }).getByRole('button')
  expect(await buttons.count()).toBeGreaterThan(3)
  await expect(
    page
      .getByRole('toolbar', { name: /commands$/ })
      .getByRole('button', { name: 'Refresh' })
      .locator('svg'),
  ).toHaveCount(1)
  expect(await consoleErrors(app!)).toEqual([])
})

test('every column of the tree matches the generated fixture exactly', async () => {
  const { fixture: f, cluster } = await scanFixture()
  const root = treeRow(page, f.root)
  expect(await cellBytes(root, 1)).toBe(f.expected.bytes)
  expect(await cellBytes(root, 2)).toBe(allocated(f.expected.rootFileSizes, cluster))
  const rootCells = await cellTexts(root)
  expect(rootCells.slice(3, 6)).toEqual([
    count.format(f.expected.files),
    count.format(f.expected.folders),
    '100.0%',
  ])

  for (const expected of f.expected.folders12) {
    const row = treeRow(page, expected.name)
    expect(await cellBytes(row, 1)).toBe(sum(expected.fileSizes))
    expect(await cellBytes(row, 2)).toBe(allocated(expected.fileSizes, cluster))
    const cells = await cellTexts(row)
    expect(cells[3]).toBe(count.format(expected.files))
    expect(cells[4]).toBe(count.format(expected.folders))
    const share = (sum(expected.fileSizes) / f.expected.bytes) * 100
    expect(cells[5]).toBe(share < 0.05 ? '<0.1%' : `${share.toFixed(1)}%`)
    expect(cells[6]).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/)
  }
  const files = treeRow(page, f.expected.rootFiles.name)
  expect(await cellBytes(files, 1)).toBe(777)
  expect(await cellBytes(files, 2)).toBe(allocated(f.expected.rootFiles.fileSizes, cluster))
  expect((await cellTexts(files))[3]).toBe('2')

  await expect(page.getByRole('contentinfo')).toContainText(
    `${count.format(f.expected.files)} files found`,
  )
  await expect(page.getByRole('contentinfo')).toContainText('0 excluded')
  await expect(page.getByRole('contentinfo')).toContainText(
    `${count.format(cluster)} bytes per cluster`,
  )
  expect(await consoleErrors(app!)).toEqual([])
})

test('sorts by a column and reverses on a second click', async () => {
  await scanFixture()
  const names = async () =>
    (
      await treegrid(page)
        .locator('[role="row"] > [role="gridcell"]:first-child span[title]')
        .allTextContents()
    ).slice(1, 4)
  expect(await names()).toEqual(['folder-12', 'folder-11', 'folder-10'])
  await treegrid(page).getByRole('button', { name: /^Name/ }).click()
  await expect.poll(names).toEqual(['[2 files]', 'folder-01', 'folder-02'])
  await treegrid(page).getByRole('button', { name: /^Name/ }).click()
  await expect.poll(names).toEqual(['folder-12', 'folder-11', 'folder-10'])
  await expect(treegrid(page).getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
    'aria-sort',
    'descending',
  )
})

test('expands and moves with the keyboard, and copies the selected path', async () => {
  const { fixture: f } = await scanFixture()
  await treegrid(page).focus()
  await page.keyboard.press('ArrowDown')
  await expect(treeRow(page, 'folder-12')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowRight')
  await expect(treeRow(page, 'nested')).toHaveAttribute('aria-level', '3')
  // Children are sorted by size: "[3 files]" (36,000 bytes) comes before "nested" (24,000).
  await page.keyboard.press('ArrowRight')
  await expect(treeRow(page, '[3 files]')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(treeRow(page, 'nested')).toHaveAttribute('aria-selected', 'true')
  // Ctrl+C goes through copyNodePath: main resolves the path from the scan and writes it.
  await page.keyboard.press('Control+c')
  await expect
    .poll(() => app!.evaluate(({ clipboard }) => clipboard.readText()))
    .toBe(path.join(f.root, 'folder-12', 'nested'))
  await page.keyboard.press('ArrowLeft')
  await expect(treeRow(page, 'folder-12')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(treeRow(page, 'nested')).toHaveCount(0)
})

test('a treemap click selects the matching tree row; a double-click drills in', async () => {
  await scanFixture()
  const canvas = page.getByRole('img', { name: /^Treemap of/ })
  await expect(canvas).toBeVisible()
  // Squarify places the largest child (folder-12) first, at the top-left corner; at Level 1
  // the point (10, 10) is in its label strip, above its nested blocks.
  await canvas.click({ position: { x: 10, y: 10 } })
  await expect(treeRow(page, 'folder-12')).toHaveAttribute('aria-selected', 'true')
  await canvas.dblclick({ position: { x: 10, y: 10 } })
  await expect(canvas).toHaveAccessibleName(/^Treemap of folder-12/)
  await page
    .getByRole('toolbar', { name: 'Treemap levels' })
    .getByRole('button', { name: 'Level 0' })
    .click()
  await expect(
    page.getByRole('toolbar', { name: 'Treemap levels' }).getByRole('button', { name: 'Level 0' }),
  ).toHaveAttribute('aria-pressed', 'true')
})

test('the treemap legend names the file types with their shares after a scan', async () => {
  await scanFixture()
  const legend = page.getByRole('list', { name: 'File types in this folder' })
  await expect(legend).toBeVisible()
  const items = legend.getByRole('listitem')
  await expect.poll(() => items.count()).toBeGreaterThan(0)
  // The fixture mixes video, image, document, archive, app and code files, so the legend names
  // those categories with their shares and is not a single "Other 100%".
  for (const label of ['Video', 'Images', 'Documents', 'Archives', 'Apps & installers', 'Code']) {
    await expect(legend.getByRole('listitem').filter({ hasText: label })).toHaveCount(1)
  }
  await expect(legend).toContainText(/\d+(\.\d)?%/)
  await expect(legend).not.toContainText('Other 100')
  for (const text of await items.allTextContents()) expect(text.trim()).not.toBe('')
})

test('hides the treemap with × and shows it from the View tab', async () => {
  await page.getByRole('button', { name: 'Hide treemap' }).click()
  await expect(page.getByRole('region', { name: 'Treemap' })).toHaveCount(0)
  await page.getByRole('tab', { name: 'View' }).click()
  await ribbonButton(page, 'Treemap').click()
  await expect(page.getByRole('region', { name: 'Treemap' })).toBeVisible()
})

test('the Explorer context menu holds StorageIQ’s items and the shell’s items', async () => {
  const { fixture: f } = await scanFixture()
  const labels = await app!.evaluate(async (_electron, target) => {
    const probe = (
      globalThis as unknown as {
        __storageiqProbeShellMenu: (path: string) => Promise<string[]>
      }
    ).__storageiqProbeShellMenu
    return probe(target)
  }, f.root)
  expect(labels.slice(0, 3)).toEqual(['&StorageIQ', 'New &folder\tCtrl+N', ''])
  const shellItems = labels.slice(3).filter((label) => label !== '')
  expect(shellItems.length).toBeGreaterThan(5)
})

test('New folder creates "New folder" and the tree shows it', async () => {
  const { fixture: f } = await scanFixture()
  await treeRow(page, 'folder-01').click()
  await treegrid(page).focus()
  await page.keyboard.press('Control+n')
  await treeRow(page, 'folder-01').dblclick()
  await expect(treeRow(page, 'New folder')).toBeVisible()
  await expect(treeRow(page, 'folder-01').getByRole('gridcell').nth(4)).toHaveText('2')
  expect(existsSync(path.join(f.root, 'folder-01', 'New folder'))).toBe(true)
})

test('the tree and the status bar update while a scan runs, and Stop ends it quickly', async () => {
  await startSystemDriveScan()
  const footer = page.getByRole('contentinfo')
  const filesFound = async () =>
    Number(
      (/([\d,]+) files found/.exec((await footer.textContent()) ?? '')?.[1] ?? '0').replace(
        /,/g,
        '',
      ),
    )
  await expect.poll(filesFound).toBeGreaterThan(0)
  const first = await filesFound()
  await expect.poll(filesFound, { timeout: 10_000 }).toBeGreaterThan(first)
  await expect(treegrid(page).getByRole('row').nth(1)).toBeVisible()
  await expect(footer).toContainText('bytes per cluster')

  const clickedAt = Date.now()
  await ribbonButton(page, 'Stop').click()
  await expect(ribbonButton(page, 'Stop')).toHaveAttribute('aria-disabled', 'true')
  expect(Date.now() - clickedAt).toBeLessThan(2_000)
})

test('shows the crash banner when the scanner process dies, and Retry scans again', async () => {
  await startSystemDriveScan()
  const pid = await scannerPid()
  expect(pid).toBeDefined()
  process.kill(pid!)
  await expect(page.getByRole('alert')).toContainText(
    'The scan stopped unexpectedly. You can try again.',
  )
  await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click()
  await expect(ribbonButton(page, 'Stop')).not.toHaveAttribute('aria-disabled', 'true')
})

test('quitting during a scan leaves no scanner process behind', async () => {
  await startSystemDriveScan()
  const pid = await scannerPid()
  expect(pid).toBeDefined()
  await app!.close()
  app = undefined
  await expect.poll(() => isAlive(pid!), { timeout: 5_000 }).toBe(false)
})

test('a scanned folder appears under "Recently scanned"', async () => {
  const { fixture: f } = await scanFixture()
  const menu = await openSelectMenu(page)
  await expect(menu.getByRole('group', { name: 'Recently scanned' })).toContainText(f.root)
})

test('selecting several rows with ctrl click shows the item count and total size in the status bar', async () => {
  await scanFixture()
  await treeRow(page, 'folder-12').click()
  await treeRow(page, 'folder-11').click({ modifiers: ['Control'] })
  await expect(treeRow(page, 'folder-12')).toHaveAttribute('aria-selected', 'true')
  await expect(treeRow(page, 'folder-11')).toHaveAttribute('aria-selected', 'true')
  const bytes =
    (await cellBytes(treeRow(page, 'folder-12'), 1)) +
    (await cellBytes(treeRow(page, 'folder-11'), 1))
  const footer = page.getByRole('contentinfo')
  await expect(footer).toContainText('2 items selected, total size')
  const text = (await footer.textContent()) ?? ''
  const match = /2 items selected, total size ([\d.,]+) (B|KB|MB|GB|TB)/.exec(text)
  expect(match).not.toBeNull()
  const unit = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[match![2] as 'B']
  // The status bar rounds to one decimal of its unit (a whole unit from 100 up).
  expect(Math.abs(Number(match![1]!.replace(/,/g, '')) * unit - bytes)).toBeLessThanOrEqual(
    unit * 0.51,
  )
  // A plain click goes back to one row and the extra text disappears.
  await treeRow(page, 'folder-10').click()
  await expect(footer).not.toContainText('items selected')
})

test('shift click selects a range and shift arrow extends it', async () => {
  await scanFixture()
  await treeRow(page, 'folder-12').click()
  await treeRow(page, 'folder-10').click({ modifiers: ['Shift'] })
  for (const name of ['folder-12', 'folder-11', 'folder-10']) {
    await expect(treeRow(page, name)).toHaveAttribute('aria-selected', 'true')
  }
  await expect(treeRow(page, 'folder-09')).toHaveAttribute('aria-selected', 'false')
  await expect(treegrid(page)).toBeFocused()
  await page.keyboard.press('Shift+ArrowDown')
  await expect(treeRow(page, 'folder-09')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('contentinfo')).toContainText('4 items selected')
})

test('ctrl A selects all visible rows', async () => {
  await scanFixture()
  await treegrid(page).focus()
  await page.keyboard.press('Control+a')
  const rows = treegrid(page).locator('[role="row"][id^="tree-row-"]')
  const total = await rows.count()
  // The root, 12 folders and the root's "[N files]" row.
  expect(total).toBe(14)
  await expect(treegrid(page).locator('[role="row"][aria-selected="true"]')).toHaveCount(total)
  await expect(page.getByRole('contentinfo')).toContainText(`${total} items selected`)
})

test('the treemap highlights only the active row', async () => {
  await scanFixture()
  const canvas = page.getByRole('img', { name: /^Treemap of/ })
  await treeRow(page, 'folder-12').click()
  await treeRow(page, 'folder-11').click({ modifiers: ['Control'] })
  // Two rows are selected, but the treemap follows the active row (the last one clicked) only.
  await expect(treegrid(page).locator('[role="row"][aria-selected="true"]')).toHaveCount(2)
  await expect(canvas).toHaveAccessibleName(/^Treemap of folder-11/)
  await expect(treegrid(page).locator('[role="row"][data-active]')).toHaveCount(1)
  await expect(treeRow(page, 'folder-11')).toHaveAttribute('data-active', 'true')
})

test('escape reduces the selection to the active row', async () => {
  await scanFixture()
  await treeRow(page, 'folder-12').click()
  await treeRow(page, 'folder-10').click({ modifiers: ['Shift'] })
  await expect(treegrid(page).locator('[role="row"][aria-selected="true"]')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(treegrid(page).locator('[role="row"][aria-selected="true"]')).toHaveCount(1)
  await expect(treeRow(page, 'folder-10')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('contentinfo')).not.toContainText('items selected')
})

test('the Explorer menu request carries every selected row, with the scanner’s paths', async () => {
  const { fixture: f } = await scanFixture()
  await treeRow(page, 'folder-12').click()
  await treeRow(page, 'folder-11').click({ modifiers: ['Control'] })
  await page.keyboard.press('Shift+F10')
  const requests = await expect
    .poll(() =>
      app!.evaluate(() => {
        const hook = (globalThis as unknown as { __storageiqMenuRequests: () => unknown[] | null })
          .__storageiqMenuRequests
        return hook()
      }),
    )
    .toHaveLength(1)
    .then(() =>
      app!.evaluate(() =>
        (
          globalThis as unknown as {
            __storageiqMenuRequests: () => Array<{ paths: string[]; hideDestructive: boolean }>
          }
        ).__storageiqMenuRequests(),
      ),
    )
  expect(requests[0]?.paths).toEqual([
    path.join(f.root, 'folder-12'),
    path.join(f.root, 'folder-11'),
  ])
  expect(requests[0]?.hideDestructive).toBe(false)
})

test('the Options tab renders its Application group', async () => {
  await page.getByRole('tab', { name: 'Options' }).click()
  const group = page.getByRole('group', { name: 'Application' })
  await expect(group).toBeVisible()
  await expect(group.getByRole('checkbox')).toHaveCount(2)
  await expect(
    group.getByRole('checkbox', { name: 'Show StorageIQ in Explorer’s context menu' }),
  ).toBeVisible()
  await expect(
    group.getByRole('checkbox', { name: 'Always start StorageIQ as administrator' }),
  ).toBeVisible()
})

test('both Options checkboxes are disabled in an unpackaged run with the explanation', async () => {
  await page.getByRole('tab', { name: 'Options' }).click()
  const group = page.getByRole('group', { name: 'Application' })
  await expect(group.getByText('Available in the installed app')).toBeVisible()
  for (const box of await group.getByRole('checkbox').all()) {
    await expect(box).toBeDisabled()
  }
})

/** Restarts the app the way Explorer's menu would: with `--scan <path>` after the app folder. */
async function relaunchWithScan(target: string): Promise<void> {
  await app?.close()
  const launched = await launchApp(['--scan', target])
  app = launched.app
  page = launched.page
}

test('launching with --scan <fixture folder> starts a scan of it', async () => {
  fixture = createScanFixture()
  await relaunchWithScan(fixture.root)
  await expect(treeRow(page, 'folder-12')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText(
    `${count.format(fixture.expected.files)} files found`,
  )
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('launching with --scan <missing folder> shows the calm message and no scan', async () => {
  const missing = path.join(`${systemDrive}\\`, `storageiq-no-such-folder-${Date.now()}`)
  await relaunchWithScan(missing)
  await expect(page.getByRole('alert')).toHaveText(/That folder could not be found\./)
  await expect(page.getByRole('alert')).not.toContainText('storageiq-no-such-folder')
  // No scan started: nothing to stop and nothing to refresh.
  await expect(ribbonButton(page, 'Stop')).toBeDisabled()
  await expect(ribbonButton(page, 'Refresh')).toBeDisabled()
  await expect(page.getByRole('contentinfo')).not.toContainText('files found')
})
