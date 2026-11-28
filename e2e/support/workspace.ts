import { type ElectronApplication, expect, type Locator, type Page } from '@playwright/test'
import type { StorageIQApi } from '../../src/shared/ipc-contract'
import type { DriveDetails } from '../../src/shared/scan-types'

export const count = new Intl.NumberFormat('en-US')

/** Makes the next native folder dialog return `folder`. */
export async function stubFolderDialog(app: ElectronApplication, folder: string): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [chosen],
    })) as typeof dialog.showOpenDialog
  }, folder)
}

/**
 * Makes the native save dialog return `file`, or "cancelled" when `file` is null, so no dialog is
 * ever shown to the person at the desk.
 */
export async function stubSaveDialog(app: ElectronApplication, file: string | null): Promise<void> {
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showSaveDialog = (async () =>
      chosen === null
        ? { canceled: true, filePath: '' }
        : { canceled: false, filePath: chosen }) as typeof dialog.showSaveDialog
  }, file)
}

/** A command of the ribbon's active tab (the level bar is a toolbar too, so match by name). */
export function ribbonButton(page: Page, name: string | RegExp): Locator {
  return page.getByRole('toolbar', { name: /commands$/ }).getByRole('button', { name })
}

export async function openSelectMenu(page: Page): Promise<Locator> {
  await ribbonButton(page, /^Select/).click()
  const menu = page.getByRole('menu', { name: 'Select a drive or folder' })
  await expect(menu).toBeVisible()
  return menu
}

/** Picks `folder` through Select → "Choose a folder…" and waits for the scan to end. */
export async function scanFolder(app: ElectronApplication, page: Page, folder: string) {
  await stubFolderDialog(app, folder)
  const menu = await openSelectMenu(page)
  await menu.getByRole('menuitem', { name: 'Choose a folder…' }).click()
  await expect(ribbonButton(page, 'Refresh')).not.toHaveAttribute('aria-disabled', 'true', {
    timeout: 20_000,
  })
}

export const treegrid = (page: Page) => page.getByRole('treegrid', { name: 'Folder tree' })

/** The tree row whose name cell ends with `name`. */
export function treeRow(page: Page, name: string): Locator {
  return treegrid(page)
    .getByRole('row')
    .filter({ has: page.getByRole('gridcell').first().getByTitle(name, { exact: true }) })
}

export async function cellTexts(row: Locator): Promise<string[]> {
  return row.getByRole('gridcell').allTextContents()
}

export async function cellBytes(row: Locator, column: 1 | 2): Promise<number> {
  return Number(await row.getByRole('gridcell').nth(column).getAttribute('data-bytes'))
}

export function driveDetails(page: Page, root: string): Promise<DriveDetails | null> {
  return page.evaluate(
    (driveRoot) =>
      (globalThis as unknown as { storageiq: StorageIQApi }).storageiq.getDriveInfo(driveRoot),
    root,
  )
}
