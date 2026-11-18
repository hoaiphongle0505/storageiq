import {
  _electron as electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from '@playwright/test'

let app: ElectronApplication | undefined
let page: Page
let consoleErrors: string[] = []

// ELECTRON_RUN_AS_NODE makes Electron behave as plain Node, so it must not leak into the launch.
const launchEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE',
  ),
)

test.beforeEach(async () => {
  app = await electron.launch({ args: ['.'], env: launchEnv })
  consoleErrors = []
  page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
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
  expect(keys).toEqual(['getAppInfo', 'selectFolder'])
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

test('logs no console errors or CSP violations after load and after choosing a folder', async () => {
  await expect(page.getByRole('contentinfo').getByText(/^StorageIQ \d/)).toBeVisible()
  await page.evaluate(() => {
    interface Scope {
      __cspViolations: string[]
      document: EventTarget
    }
    interface Violation extends Event {
      violatedDirective: string
      blockedURI: string
    }
    const scope = globalThis as unknown as Scope
    scope.__cspViolations = []
    scope.document.addEventListener('securitypolicyviolation', (event) => {
      const violation = event as Violation
      scope.__cspViolations.push(`${violation.violatedDirective} ${violation.blockedURI}`)
    })
  })
  const violations = () =>
    page.evaluate(() => (globalThis as unknown as { __cspViolations: string[] }).__cspViolations)
  expect(consoleErrors).toEqual([])
  expect(await violations()).toEqual([])

  await app!.evaluate(({ dialog }) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: ['C:\\StorageIQ-e2e'],
    })) as typeof dialog.showOpenDialog
  })
  await page.getByRole('button', { name: 'Choose folder' }).click()
  await expect(page.getByText('Selected folder')).toBeVisible()

  expect(consoleErrors).toEqual([])
  expect(await violations()).toEqual([])
})
