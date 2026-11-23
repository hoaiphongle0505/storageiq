import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { createScanFixture } from './support/fixture'
import { launchApp } from './support/launch'
import { openSelectMenu, ribbonButton, scanFolder, treegrid, treeRow } from './support/workspace'

// By-eye check (spec §5): every view in light and dark. Not a gate; run on demand with
// STORAGEIQ_SCREENSHOTS=1 and look at screenshots/*.png.
test.skip(process.env['STORAGEIQ_SCREENSHOTS'] !== '1', 'Set STORAGEIQ_SCREENSHOTS=1')

for (const scheme of ['light', 'dark'] as const) {
  test(`captures every view in ${scheme} mode`, async () => {
    test.setTimeout(120_000)
    const dir = path.resolve('screenshots')
    mkdirSync(dir, { recursive: true })
    const fixture = createScanFixture()
    const { app, page } = await launchApp()
    try {
      await page.emulateMedia({ colorScheme: scheme })
      const shot = (name: string) =>
        page.screenshot({ path: path.join(dir, `${scheme}-${name}.png`) })
      await expect(treegrid(page)).toBeVisible()
      await shot('1-empty')
      await openSelectMenu(page)
      await shot('2-select-menu')
      await page.keyboard.press('Escape')
      await scanFolder(app, page, fixture.root)
      await treeRow(page, 'folder-12').dblclick()
      await shot('3-tree-and-treemap')
      await expect(page.getByRole('list', { name: 'File types in this folder' })).toBeVisible()
      await page
        .getByRole('region', { name: 'Treemap' })
        .screenshot({ path: path.join(dir, `${scheme}-3b-treemap-with-legend.png`) })
      await page
        .getByRole('toolbar', { name: 'Treemap levels' })
        .getByRole('button', { name: 'Level 3' })
        .click()
      await ribbonButton(page, 'Allocated').click()
      await shot('4-allocated-level-3')
      await page.getByRole('tab', { name: 'View' }).click()
      await ribbonButton(page, 'Treemap').click()
      await shot('5-view-tab-treemap-hidden')
      await page.getByRole('tab', { name: 'File' }).click()
      await ribbonButton(page, 'About').click()
      await shot('6-about')
      await page.keyboard.press('Escape')
      await page.getByRole('tab', { name: 'Home' }).click()
      const menu = await openSelectMenu(page)
      await menu
        .getByRole('menuitem', { name: new RegExp(`\\(${process.env['SystemDrive'] ?? 'C:'}\\)`) })
        .click()
      await page.waitForTimeout(2_000)
      await shot('7-scanning-drive')
      await ribbonButton(page, 'Stop').click()
    } finally {
      await app.close()
      fixture.remove()
    }
  })
}
