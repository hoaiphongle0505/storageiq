import type { ReleaseNotes, UpdateState } from '@shared/ipc-contract'
import { htmlToPlainText } from '../about/release-notes'

/** First update check after start, so the check never competes with startup work. */
export const UPDATE_FIRST_CHECK_DELAY_MS = 10_000
/** Time between background checks (6 h). */
export const UPDATE_CHECK_INTERVAL_MS = 21_600_000
/** A check that has not answered after this long is treated as failed. */
export const UPDATE_CHECK_TIMEOUT_MS = 60_000

const CHECK_ERROR = 'Could not check for updates. Check your connection and try again.'
const DOWNLOAD_ERROR = 'Could not download the update. Try again.'
const UNAVAILABLE = 'Updates are available in the installed app.'

/** The part of electron-updater's `autoUpdater` that StorageIQ uses (lets tests fake it). */
export interface UpdaterLike {
  autoDownload: boolean
  allowPrerelease: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  on(event: 'checking-for-update', listener: () => void): unknown
  on(event: 'update-not-available', listener: () => void): unknown
  on(
    event: 'update-available',
    listener: (info: { version: string; releaseNotes?: unknown }) => void,
  ): unknown
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown
  on(event: 'update-downloaded', listener: (info: { version: string }) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterDeps {
  autoUpdater: UpdaterLike
  isPackaged: boolean
  selfTest: boolean
  /** The installed app version; its channel decides whether pre-releases are offered. */
  version: string
  send(event: 'update:state', payload: UpdateState): void
  /** One-shot timer; returns its cancel function. */
  schedule(callback: () => void, ms: number): () => void
  /** Repeating timer; returns its cancel function. */
  scheduleEvery(callback: () => void, ms: number): () => void
  log(message: string, error?: unknown): void
}

export interface Updater {
  start(): void
  /** A manual check; a no-op while checking, available, downloading or ready. */
  checkNow(): UpdateState
  /** Downloads the found update; does nothing unless one is available. */
  download(): void
  /** Quits and installs the downloaded update; does nothing before one is ready. */
  install(): void
  dispose(): void
  readonly state: UpdateState
  readonly releaseNotes: ReleaseNotes | null
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
 *
 * The user chooses: a found update is announced (`available`), `download()` fetches it and
 * `install()` restarts into it. `autoInstallOnAppQuit` stays on, so a downloaded update also
 * installs at the next normal quit. Nothing runs when the app is unpackaged or under
 * `--self-test` (`checkNow` reports `unavailable`). A failure is logged raw and shown as a fixed
 * message; the updater never opens a dialog and never throws into the main process.
 */
export function createUpdater(deps: UpdaterDeps): Updater {
  const { autoUpdater } = deps
  let state: UpdateState = { kind: 'idle' }
  let notesText: string | null = null
  let manual = false
  let started = false
  let cancelTimeout: (() => void) | null = null
  const cancels: (() => void)[] = []

  const setState = (next: UpdateState) => {
    if (JSON.stringify(next) === JSON.stringify(state)) return
    state = next
    deps.send('update:state', state)
  }

  const clearTimeoutGuard = () => {
    cancelTimeout?.()
    cancelTimeout = null
  }

  const cancelAll = () => {
    clearTimeoutGuard()
    for (const cancel of cancels.splice(0)) cancel()
  }

  const fail = (error: unknown) => {
    deps.log('Update failed', error)
    if (state.kind === 'checking') {
      clearTimeoutGuard()
      setState(manual ? { kind: 'error', message: CHECK_ERROR, during: 'check' } : { kind: 'idle' })
    } else if (state.kind === 'downloading') {
      setState({ kind: 'error', message: DOWNLOAD_ERROR, during: 'download' })
    }
  }

  const beginCheck = (isManual: boolean) => {
    manual = isManual
    setState({ kind: 'checking' })
    clearTimeoutGuard()
    cancelTimeout = deps.schedule(() => {
      cancelTimeout = null
      fail(new Error('Update check timed out'))
    }, UPDATE_CHECK_TIMEOUT_MS)
    try {
      autoUpdater.checkForUpdates().catch(fail)
    } catch (error) {
      fail(error)
    }
  }

  const backgroundTick = () => {
    if (state.kind === 'idle' || state.kind === 'up-to-date' || state.kind === 'error') {
      beginCheck(false)
    }
  }

  return {
    start() {
      if (!deps.isPackaged || deps.selfTest || started) return
      started = true
      autoUpdater.autoDownload = false
      autoUpdater.autoInstallOnAppQuit = true
      autoUpdater.allowPrerelease = hasPrereleaseTag(deps.version)
      autoUpdater.on('error', fail)
      autoUpdater.on('update-available', (info) => {
        clearTimeoutGuard()
        notesText = htmlToPlainText(info.releaseNotes)
        setState({ kind: 'available', version: info.version })
      })
      autoUpdater.on('update-not-available', () => {
        clearTimeoutGuard()
        setState({ kind: 'up-to-date' })
      })
      autoUpdater.on('download-progress', (progress) => {
        if (state.kind !== 'downloading') return
        if (!Number.isFinite(progress.percent)) return
        const percent = Math.min(100, Math.max(0, Math.round(progress.percent)))
        setState({ kind: 'downloading', version: state.version, percent })
      })
      autoUpdater.on('update-downloaded', (info) => {
        cancelAll() // nothing more to download
        setState({ kind: 'ready', version: info.version })
      })
      cancels.push(
        deps.schedule(() => {
          backgroundTick()
          cancels.push(deps.scheduleEvery(backgroundTick, UPDATE_CHECK_INTERVAL_MS))
        }, UPDATE_FIRST_CHECK_DELAY_MS),
      )
    },

    checkNow() {
      if (!deps.isPackaged || deps.selfTest) {
        setState({ kind: 'unavailable', message: UNAVAILABLE })
        return state
      }
      if (state.kind === 'checking') {
        manual = true // the user's intent surfaces the result of a check already running
        return state
      }
      if (state.kind === 'downloading' || state.kind === 'available' || state.kind === 'ready') {
        return state
      }
      beginCheck(true)
      return state
    },

    download() {
      if (state.kind !== 'available') return
      setState({ kind: 'downloading', version: state.version, percent: 0 })
      try {
        autoUpdater.downloadUpdate().catch(fail)
      } catch (error) {
        fail(error)
      }
    },

    install() {
      if (state.kind !== 'ready') return
      autoUpdater.quitAndInstall(true, true)
    },

    dispose() {
      cancelAll()
    },

    get state() {
      return state
    },

    get releaseNotes() {
      if (state.kind === 'available' || state.kind === 'downloading' || state.kind === 'ready') {
        return { version: state.version, text: notesText }
      }
      return null
    },
  }
}
