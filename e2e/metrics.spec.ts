import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createLargeFixture } from './support/fixture'
import { launchApp } from './support/launch'

// Report-only CI metrics (roadmap carry-over 7). Never gating; skipped unless asked for.
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

    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [folder],
      })) as typeof dialog.showOpenDialog
    }, fixture.root)
    let startedAt = Date.now()
    await page.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Scan complete' })).toBeVisible({
      timeout: 240_000,
    })
    const scanWallMs = Date.now() - startedAt

    await page.getByRole('button', { name: 'Choose another location' }).click()
    const systemDrive = process.env['SystemDrive'] ?? 'C:'
    await page
      .getByRole('list', { name: 'Drives' })
      .getByRole('button', { name: new RegExp(`\\(${systemDrive}\\)`) })
      .click()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await page.waitForTimeout(1_000)
    startedAt = Date.now()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Scan canceled — partial results' }),
    ).toBeVisible()
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
