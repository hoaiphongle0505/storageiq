import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createLargeFixture } from './support/fixture'
import { launchApp } from './support/launch'
import { openSelectMenu, ribbonButton, scanFolder } from './support/workspace'

// Report-only CI metrics. Never gating; skipped unless asked for.
test.skip(process.env['STORAGEIQ_METRICS'] !== '1', 'Set STORAGEIQ_METRICS=1 to collect metrics')

test('collects idle RAM, scan time for about 20,000 files and cancel latency', async () => {
  test.setTimeout(300_000)
  const fixture = createLargeFixture(20_000)
  const { app, page } = await launchApp()
  try {
    await expect(page.getByRole('contentinfo').getByText(/^StorageIQ \d/)).toBeVisible()
    await page.waitForTimeout(5_000)
    const idleWorkingSetKb = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0),
    )

    let startedAt = Date.now()
    await scanFolder(app, page, fixture.root)
    const scanWallMs = Date.now() - startedAt

    const systemDrive = process.env['SystemDrive'] ?? 'C:'
    const menu = await openSelectMenu(page)
    await menu.getByRole('menuitem', { name: new RegExp(`\\(${systemDrive}\\)`) }).click()
    await expect(ribbonButton(page, 'Stop')).not.toHaveAttribute('aria-disabled', 'true')
    await page.waitForTimeout(1_000)
    startedAt = Date.now()
    await ribbonButton(page, 'Stop').click()
    await expect(ribbonButton(page, 'Stop')).toHaveAttribute('aria-disabled', 'true')
    const cancelMs = Date.now() - startedAt

    mkdirSync('metrics', { recursive: true })
    writeFileSync(
      'metrics/e2e-metrics.json',
      JSON.stringify(
        {
          idleWorkingSetKb,
          idleWorkingSetMb: Math.round(idleWorkingSetKb / 1024),
          scanFiles: fixture.files,
          scanWallMs,
          cancelMs,
        },
        null,
        2,
      ),
    )
  } finally {
    await app.close()
    fixture.remove()
  }
})
