import path from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

// ELECTRON_RUN_AS_NODE makes Electron behave as plain Node, so it must not leak into the launch.
// STORAGEIQ_TEST_HOOKS exposes the test-only Explorer-menu probe in main (unpackaged runs only).
export const launchEnv: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  ),
  STORAGEIQ_TEST_HOOKS: '1',
}

const captureHook = path.join(__dirname, 'capture-console.cjs')

export interface LaunchedApp {
  app: ElectronApplication
  page: Page
}

/** Launches the built app with the console/CSP capture hook loaded before the main script. */
export async function launchApp(): Promise<LaunchedApp> {
  const app = await electron.launch({ args: ['-r', captureHook, '.'], env: launchEnv })
  const page = await app.firstWindow()
  return { app, page }
}

interface CaptureScope {
  __e2eConsoleErrors: string[]
  __e2eCspListenerReady: boolean
}

/** Every renderer console error since launch, including `[csp] …` violation reports. */
export function consoleErrors(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => [...(globalThis as unknown as CaptureScope).__e2eConsoleErrors])
}

export function cspListenerReady(app: ElectronApplication): Promise<boolean> {
  return app.evaluate(() => (globalThis as unknown as CaptureScope).__e2eCspListenerReady)
}
