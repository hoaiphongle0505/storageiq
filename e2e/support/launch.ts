import { mkdtempSync } from 'node:fs'
import os from 'node:os'
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
  /** The profile folder of this launch; a second process given the same one is a second instance. */
  userData: string
}

/** Launches the built app with the console/CSP capture hook loaded before the main script. */
/** `extraArgs` follow the app folder, as a shell launch would pass them (for example `--scan`). */
export async function launchApp(extraArgs: string[] = [], profile?: string): Promise<LaunchedApp> {
  // A fresh profile per launch: no stored What's new state or recent scans from earlier runs.
  const userData = profile ?? mkdtempSync(path.join(os.tmpdir(), 'storageiq-e2e-profile-'))
  const app = await electron.launch({
    args: ['-r', captureHook, '.', ...extraArgs],
    env: { ...launchEnv, STORAGEIQ_TEST_USER_DATA: userData },
  })
  const page = await app.firstWindow()
  return { app, page, userData }
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
