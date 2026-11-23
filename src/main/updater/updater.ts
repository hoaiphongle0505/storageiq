import type { UpdateReady } from '@shared/ipc-contract'

/** First update check after start, so the check never competes with startup work. */
export const UPDATE_FIRST_CHECK_DELAY_MS = 10_000
/** Time between checks (6 h) while no update has been downloaded. */
export const UPDATE_CHECK_INTERVAL_MS = 21_600_000

/** The part of electron-updater's `autoUpdater` that StorageIQ uses (lets tests fake it). */
export interface UpdaterLike {
  autoDownload: boolean
  allowPrerelease: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterDeps {
  autoUpdater: UpdaterLike
  isPackaged: boolean
  selfTest: boolean
  /** The installed app version; its channel decides whether pre-releases are offered. */
  version: string
  send(event: 'update:ready', payload: UpdateReady): void
  /** One-shot timer; returns its cancel function. */
  schedule(callback: () => void, ms: number): () => void
  /** Repeating timer; returns its cancel function. */
  scheduleEvery(callback: () => void, ms: number): () => void
  log(message: string, error?: unknown): void
}

export interface Updater {
  start(): void
  /** Quits and installs the downloaded update; does nothing before one is ready. */
  install(): void
  dispose(): void
  readonly ready: UpdateReady | null
}

/** True when the semver has a pre-release part (`0.2.0-beta.1`), false for `0.2.0`. */
export function hasPrereleaseTag(version: string): boolean {
  const withoutBuild = version.split('+')[0] ?? ''
  return withoutBuild.includes('-')
}

/**
 * Updates the installed app from GitHub Releases (the publish block of electron-builder.yml).
 *
 * Channel: `allowPrerelease` follows the installed version. A user on `0.2.0-beta.1` receives
 * pre-releases and stable releases; a user on a stable version receives only stable releases.
 * This matches how releases are published (pre-release first, stable after).
 *
 * An update downloads on its own and installs at the next normal quit even when the banner is
 * ignored (`autoInstallOnAppQuit`); `install()` is the banner's Restart. Nothing runs when the
 * app is unpackaged or under `--self-test`. A failure is only logged: the updater never opens a
 * dialog and never throws into the main process.
 */
export function createUpdater(deps: UpdaterDeps): Updater {
  const { autoUpdater } = deps
  let ready: UpdateReady | null = null
  const cancels: (() => void)[] = []

  const cancelAll = () => {
    for (const cancel of cancels.splice(0)) cancel()
  }

  const check = () => {
    try {
      autoUpdater.checkForUpdates().catch((error: unknown) => {
        deps.log('Update check failed', error)
      })
    } catch (error) {
      deps.log('Update check failed', error)
    }
  }

  return {
    start() {
      if (!deps.isPackaged || deps.selfTest) return
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.allowPrerelease = hasPrereleaseTag(deps.version)
      autoUpdater.on('error', (error) => deps.log('Update check failed', error))
      autoUpdater.on('update-downloaded', (info) => {
        ready = { version: info.version }
        cancelAll() // nothing more to download
        deps.send('update:ready', ready)
      })
      cancels.push(
        deps.schedule(() => {
          check()
          cancels.push(deps.scheduleEvery(check, UPDATE_CHECK_INTERVAL_MS))
        }, UPDATE_FIRST_CHECK_DELAY_MS),
      )
    },

    install() {
      if (ready === null) return
      autoUpdater.quitAndInstall(false, true)
    },

    dispose() {
      cancelAll()
    },

    get ready() {
      return ready
    },
  }
}
