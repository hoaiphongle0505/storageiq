import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, realpath } from 'node:fs'
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  app,
  type BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  utilityProcess,
} from 'electron'
import type { DriveDetails, ScanDone, ScanFailed } from '@shared/scan-types'
import {
  DEFAULT_CLUSTER_BYTES,
  SCANNER_SERVICE_NAME,
  type ScanVolume,
} from '@shared/scanner-protocol'
import { MAX_PAGE_ROWS, ROOT_NODE_ID } from '@shared/tree-types'
import type { DriveApi } from './drives/drive-api'
import { driveRootOf, isDriveRoot, readDriveDetails } from './drives/drive-details'
import { createKoffiDriveApi } from './drives/koffi-drive-api'
import { listDrives } from './drives/list-drives'
import { createIconService, type IconService, type IconWorkerLike } from './icons/icon-service'
import { ICON_WORKER_DATA } from './icons/icon-worker-protocol'
import { createWhatsNewStore } from './about/whats-new-store'
import { createAboutHandlers } from './ipc/about-handlers'
import { createAppHandlers } from './ipc/app-handlers'
import { createDriveHandlers } from './ipc/drive-handlers'
import { createIconHandlers } from './ipc/icon-handlers'
import { createLaunchHandlers } from './ipc/launch-handlers'
import { createOptionsHandlers } from './ipc/options-handlers'
import { type IpcHandlerMap, registerIpcHandlers } from './ipc/register'
import { createScanHandlers } from './ipc/scan-handlers'
import { createEventSender } from './ipc/send-event'
import { createItemWatcher } from './ipc/item-watcher'
import { createShellHandlers, itemExists } from './ipc/shell-handlers'
import { createExportHandlers } from './ipc/export-handlers'
import { createFolderRefresher, createTreeHandlers } from './ipc/tree-handlers'
import { autoUpdater } from 'electron-updater'
import { findScanArgument, parseSecondInstanceData } from './launch/launch-args'
import { createLaunchCoordinator } from './launch/launch-coordinator'
import { watchRendererLifecycle } from './launch/renderer-lifecycle'
import { createAppSettingsStore } from './options/app-settings-store'
import { createOptionsService } from './options/options-service'
import { createWinRegistry } from './registry/win-registry'
import { createRecentScans, listPlaces, RECENT_SCANS_FILE } from './places/places'
import { createScanService, type ScannerChild } from './scan/scan-service'
import { hardenWebContents } from './security/harden-web-contents'
import { isTrustedRendererUrl } from './security/trusted-url'
import { isTrustedIpcSender } from './security/trusted-sender'
import { runSelfTest, SELF_TEST_FLAG, type SelfTestScan } from './self-test'
import type { ShellFinish, ShellMenuHost, ShellMenuRequest } from './shell-menu/context-menu'
import {
  createShellWorkerPool,
  disposePoolAtQuit,
  type ShellWorkerPool,
} from './shell-menu/shell-worker-pool'
import type { WorkerLike } from './shell-menu/shell-worker-pool'
import { SHELL_WORKER_DATA } from './shell-menu/shell-worker-protocol'
import { createUpdateHandlers } from './ipc/update-handlers'
import { createUpdater, type Updater } from './updater/updater'
import { createMainWindow } from './window'

const APP_USER_MODEL_ID = 'io.github.storageiq.app'
const rendererRoot = path.join(__dirname, '../renderer')
const preloadPath = path.join(__dirname, '../preload/index.js')
/** Dev windows show the logo; build/ is outside out/, so a packaged build uses the exe's icon. */
const devIconPath = app.isPackaged ? undefined : path.join(__dirname, '../../build/icon.ico')
const scannerPath = path.join(__dirname, 'scanner.js')
/** The shell worker thread (a self-contained bundle, unpacked from the asar when packaged). */
const shellWorkerPath = path.join(__dirname, 'shell-worker.js')
/** The icon worker thread (a self-contained bundle, unpacked from the asar when packaged). */
const iconWorkerPath = path.join(__dirname, 'icon-worker.js')
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
const isTrustedUrl = (url: string) => isTrustedRendererUrl(url, { rendererRoot, devServerUrl })

/** CHANGELOG.md and THIRD_PARTY_NOTICES.txt: in resources/ when packaged, else in the project. */
const changelogPath = app.isPackaged
  ? path.join(process.resourcesPath, 'CHANGELOG.md')
  : path.join(app.getAppPath(), 'CHANGELOG.md')
const noticesPath = app.isPackaged
  ? path.join(process.resourcesPath, 'THIRD_PARTY_NOTICES.txt')
  : path.join(app.getAppPath(), 'out', 'THIRD_PARTY_NOTICES.txt')
const MAX_CHANGELOG_BYTES = 256 * 1024

/** Reads at most max bytes of a text file (a larger file is cut, not refused). */
async function readBounded(file: string, max: number): Promise<string> {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(max)
    const { bytesRead } = await handle.read(buffer, 0, max, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

let mainWindow: BrowserWindow | null = null
let quitting = false
let updater: Updater | null = null
let driveApi: Promise<DriveApi> | null = null
let shellPool: ShellWorkerPool | null = null
let iconService: IconService | null = null

/** Loads koffi on first use; a failed load is retried on the next call. */
function getDriveApi(): Promise<DriveApi> {
  driveApi ??= createKoffiDriveApi().catch((error: unknown) => {
    driveApi = null
    throw error
  })
  return driveApi
}

/** Posts WM_CANCELMODE to a menu owner window so an open popup closes at quit. */
let cancelMode: ((hwnd: string) => void) | null = null
function cancelMenuWindow(hwnd: string): void {
  if (process.platform !== 'win32') return
  if (cancelMode === null) {
    // koffi is already loaded by the drive API; this is a synchronous load of user32.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const post = koffi
      .load('user32.dll')
      .func(
        'int __stdcall PostMessageW(void *hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)',
      )
    cancelMode = (handle) => {
      post(BigInt(handle), 0x1f, 0, 0)
    }
  }
  cancelMode(hwnd)
}

/** The pool of shell worker threads, created on first use. */
function getShellPool(): ShellWorkerPool {
  shellPool ??= createShellWorkerPool({
    spawn: () => {
      const worker = new Worker(packagedPath(shellWorkerPath), {
        workerData: SHELL_WORKER_DATA,
      })
      return worker as unknown as WorkerLike
    },
    maxWorkers: 3,
    idleMs: 30_000,
    cancelMenu: cancelMenuWindow,
    warn: (message) => console.warn(message),
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      timer.unref()
      return () => clearTimeout(timer)
    },
  })
  return shellPool
}

/**
 * The icon service and its single worker thread, created on first use. The worker is separate
 * from the shell worker pool: a stuck icon call must not take one of the three Explorer-action
 * slots, and it can be restarted without touching a running action.
 */
function getIconService(): IconService {
  iconService ??= createIconService({
    spawn: () =>
      new Worker(packagedPath(iconWorkerPath), {
        workerData: ICON_WORKER_DATA,
      }) as unknown as IconWorkerLike,
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      timer.unref()
      return () => clearTimeout(timer)
    },
    now: Date.now,
    maxEntries: 512,
    maxPathKeys: 4096,
  })
  return iconService
}

/** A worker thread loads a real file: inside app.asar it comes from app.asar.unpacked. */
function packagedPath(file: string): string {
  return file.includes('app.asar.unpacked')
    ? file
    : file.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}

async function listSystemDrives() {
  return listDrives(await getDriveApi())
}

async function driveDetails(root: string): Promise<DriveDetails | null> {
  try {
    return await readDriveDetails(await getDriveApi(), root)
  } catch {
    return null
  }
}

/** Cluster size for allocated sizes, and free space for the treemap when `root` is a drive. */
async function volumeFor(root: string): Promise<ScanVolume> {
  const driveRoot = driveRootOf(root)
  const details = driveRoot === null ? null : await driveDetails(driveRoot)
  return {
    clusterBytes: details?.clusterBytes ?? DEFAULT_CLUSTER_BYTES,
    freeBytes: details !== null && isDriveRoot(root) ? details.freeBytes : null,
  }
}

/** E2E only (unpackaged + STORAGEIQ_TEST_HOOKS=1): the menu requests that main received. */
const testMenuRequests: ShellMenuRequest[] | null =
  !app.isPackaged && process.env['STORAGEIQ_TEST_HOOKS'] === '1' ? [] : null

/**
 * Starts the Explorer menu at window CSS pixel `x`, `y` (converted to screen pixels) on a shell
 * worker thread; nothing here blocks the UI thread.
 */
function showContextMenuAt(request: ShellMenuRequest): ReturnType<ShellMenuHost['show']> {
  if (testMenuRequests !== null) {
    // E2E only: record the request instead of opening a native popup Playwright cannot drive.
    testMenuRequests.push(request)
    return {
      chosen: Promise.resolve({ kind: 'dismissed' }),
      finished: Promise.resolve({ ok: true }),
    }
  }
  const window = mainWindow
  if (window === null || window.isDestroyed()) {
    return {
      chosen: Promise.resolve({ kind: 'dismissed' }),
      finished: Promise.resolve({ ok: true }),
    }
  }
  const bounds = window.getContentBounds()
  const point = screen.dipToScreenPoint({ x: bounds.x + request.x, y: bounds.y + request.y })
  return getShellPool().show({ ...request, x: Math.round(point.x), y: Math.round(point.y) })
}

/** E2E only: the delete requests that main received (nothing is deleted). */
const testDeleteRequests: Array<{ paths: string[]; permanent: boolean }> | null =
  testMenuRequests === null ? null : []

/** Keyboard Delete on a shell worker thread; Windows shows its own dialogs. */
function deleteShellItems(paths: string[], permanent: boolean): Promise<ShellFinish> {
  if (testDeleteRequests !== null) {
    // E2E only: record the request, never delete.
    testDeleteRequests.push({ paths, permanent })
    return Promise.resolve({ ok: true })
  }
  return getShellPool().deleteItems(paths, permanent)
}

/** Empties a drive's Recycle Bin on a shell worker thread (E2E: never, only a recorded no-op). */
function emptyRecycleBin(root: string): Promise<ShellFinish> {
  if (testDeleteRequests !== null) return Promise.resolve({ ok: true })
  return getShellPool().emptyRecycleBin(root)
}

/**
 * The current user's SID, read once with Windows' own `whoami.exe` by its full System32 path (never
 * through PATH). Null when it cannot be read: then only the bin folder itself is emptied as a bin.
 */
let userSidPromise: Promise<string | null> | null = null
function currentUserSid(): Promise<string | null> {
  userSidPromise ??= new Promise((resolve) => {
    const whoami = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'whoami.exe')
    execFile(whoami, ['/user', '/fo', 'csv', '/nh'], { windowsHide: true }, (error, stdout) => {
      const sid = error ? '' : (stdout.split(',')[1] ?? '').replace(/[\r\n"\s]/g, '')
      resolve(/^S-1-[0-9-]+$/.test(sid) ? sid : null)
    })
  })
  return userSidPromise
}

function forkScanner(): ScannerChild {
  const child = utilityProcess.fork(scannerPath, app.isPackaged ? ['--storageiq-packaged'] : [], {
    serviceName: SCANNER_SERVICE_NAME,
  })
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => {
      child.on('message', listener)
    },
    onExit: (listener) => {
      child.on('exit', listener)
    },
    kill: () => {
      child.kill()
    },
  }
}

const sendEvent = createEventSender(() => mainWindow)
const itemWatcher = createItemWatcher({
  pathExists: itemExists,
  schedule: (callback, ms) => {
    const timer = setTimeout(callback, ms)
    return () => clearTimeout(timer)
  },
  now: Date.now,
})
const scanService = createScanService({
  forkScanner,
  sendEvent,
  createScanId: () => randomUUID(),
})

/**
 * `--scan <path>` launches (Explorer's menu, or the command line). Main validates the path and
 * hands it to the renderer, which starts the scan through the normal `scan:start` flow.
 */
const launch = createLaunchCoordinator({
  stat,
  send: (request) => sendEvent('launch:request', request),
  focus: focusMainWindow,
})

/** Self-test only: one scan in a fresh scanner process, plus the root's child rows. */
function scanOnce(root: string): Promise<SelfTestScan> {
  return new Promise((resolve) => {
    const service = createScanService({
      forkScanner,
      createScanId: () => randomUUID(),
      sendEvent: (channel, payload) => {
        if (channel === 'scan:failed') {
          service.dispose()
          resolve({ failed: payload as ScanFailed })
          return
        }
        if (channel !== 'scan:done') return
        const done = payload as ScanDone
        service
          .query({
            kind: 'children',
            scanId: done.scanId,
            nodeId: ROOT_NODE_ID,
            sortKey: 'name',
            sortDir: 'asc',
            offset: 0,
            limit: MAX_PAGE_ROWS,
          })
          .then(
            (page) => resolve({ done, rootChildren: page?.rows ?? [] }),
            () => resolve({ done, rootChildren: [] }),
          )
          .finally(() => service.dispose())
      },
    })
    service.start(root, { clusterBytes: DEFAULT_CLUSTER_BYTES, freeBytes: null })
  })
}

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

function reportStartupError(error: unknown): void {
  dialog.showErrorBox('StorageIQ could not start', String(error))
  app.quit()
}

// Dev and E2E runs get their own userData folder (and so their own single-instance lock).
if (!app.isPackaged) {
  // E2E launches pass a fresh folder, so a persistent profile never leaks state between runs.
  const testUserData = process.env['STORAGEIQ_TEST_USER_DATA']
  app.setPath(
    'userData',
    testUserData !== undefined && process.env['STORAGEIQ_TEST_HOOKS'] === '1'
      ? testUserData
      : path.join(app.getPath('appData'), 'StorageIQ-dev'),
  )
}

if (process.argv.includes(SELF_TEST_FLAG)) {
  // No window, no single-instance lock: list drives, build the Explorer menu, run one scan,
  // exit with a status code. A temp userData keeps this run away from a live instance's profile.
  app.setPath('userData', path.join(app.getPath('temp'), 'StorageIQ-self-test'))
  app
    .whenReady()
    .then(() =>
      runSelfTest({
        listDrives: listSystemDrives,
        unpackedNativeModule: app.isPackaged
          ? path.join(
              process.resourcesPath,
              'app.asar.unpacked',
              'node_modules',
              '@koromix',
              'koffi-win32-x64',
              'win32_x64',
              'koffi.node',
            )
          : null,
        fileExists: existsSync,
        scanRoot: process.resourcesPath,
        scanOnce,
        probeShellMenu: (target) => getShellPool().probe([target]),
        probeIcon: async () =>
          (
            await getIconService().request([
              { key: 'ext:txt', target: { kind: 'file', ext: 'txt' } },
            ])
          ).images['ext:txt']?.small ?? '',
        probeRegistry: () => {
          // Only a throwaway key: the real Explorer and compatibility entries are never touched.
          const registry = createWinRegistry()
          const key = 'Software\\StorageIQ-Test\\self-test'
          try {
            registry.setString(key, 'Probe', 'round-trip ✓')
            if (registry.getString('HKCU', key, 'Probe') !== 'round-trip ✓') {
              throw new Error('the value read back differs from the value written')
            }
          } finally {
            registry.deleteTree(key)
          }
        },
        log: (line) => {
          process.stdout.write(`[self-test] ${line}\n`)
        },
      }),
    )
    .then(
      (code) => app.exit(code),
      (error: unknown) => {
        process.stderr.write(`[self-test] ${String(error)}\n`)
        app.exit(1)
      },
    )
} else if (!app.requestSingleInstanceLock({ scan: findScanArgument(process.argv) })) {
  app.quit()
} else {
  // The second process's own command line, sent through the lock: the argv below is rebuilt by
  // Chromium and not reliable. Plain launches (no additionalData) only focus the window.
  app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
    focusMainWindow()
    const argv = parseSecondInstanceData(additionalData)
    if (argv !== null) void launch.handleArgv(argv)
  })
  hardenWebContents(app, isTrustedUrl)
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    quitting = true
    itemWatcher.cancelAll()
    // A thread inside a shell or icon call cannot be interrupted, so the process may linger until
    // it returns: always release the single-instance lock so a relaunch is not blocked meanwhile.
    disposePoolAtQuit(shellPool, () => app.releaseSingleInstanceLock())
    iconService?.dispose()
    updater?.dispose()
    scanService.dispose() // kills the scanner; no event is sent during quit
  })

  // E2E only (unpackaged + STORAGEIQ_TEST_HOOKS=1): list the Explorer menu's labels for a path
  // without showing it, because Playwright cannot drive a native menu.
  if (!app.isPackaged && process.env['STORAGEIQ_TEST_HOOKS'] === '1') {
    Object.assign(globalThis, {
      __storageiqProbeShellMenu: (target: string) => getShellPool().probe([target]),
      // The menu requests recorded instead of shown (see showContextMenuAt).
      __storageiqMenuRequests: () => testMenuRequests,
      __storageiqDeleteRequests: () => testDeleteRequests,
    })
  }

  app
    .whenReady()
    .then(async () => {
      app.setAppUserModelId(APP_USER_MODEL_ID)
      // StorageIQ's own settings (userData/settings.json). Read now, answered from memory after.
      const appSettings = createAppSettingsStore({
        filePath: path.join(app.getPath('userData'), 'settings.json'),
        readFile: (file) => readFile(file, 'utf8'),
        writeFile: (file, text) => writeFile(file, text, 'utf8'),
        rename,
        log: (message, error) => console.warn(message, error),
      })
      let autoUpdate = true
      const autoUpdateLoaded = appSettings.readAutoUpdate().then((value) => {
        autoUpdate = value
      })
      if (app.isPackaged) {
        Menu.setApplicationMenu(null)
      }

      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      session.defaultSession.setPermissionCheckHandler(() => false)

      const recent = createRecentScans({
        file: path.join(app.getPath('userData'), RECENT_SCANS_FILE),
        readFile: (file) => readFile(file, 'utf8'),
        writeFile: (file, text) => writeFile(file, text, 'utf8'),
      })
      const options = createOptionsService({
        registry: createWinRegistry(),
        exePath: process.execPath,
        isPackaged: app.isPackaged,
        warn: (message, error) => console.warn(message, error),
      })
      const refreshFolder = createFolderRefresher(scanService, sendEvent, volumeFor)

      const handlers = {
        ...createAppHandlers({
          app,
          dialog,
          getMainWindow: () => mainWindow,
          runtime: {
            platform: process.platform,
            arch: process.arch,
            electronVersion: process.versions.electron,
            chromeVersion: process.versions.chrome,
          },
          installUpdate: () => updater?.install(),
        }),
        ...createUpdateHandlers({
          getUpdateState: () => updater?.state ?? { kind: 'idle' },
          checkForUpdates: () => updater?.checkNow() ?? { kind: 'idle' },
          downloadUpdate: () => updater?.download(),
          getReleaseNotes: () => updater?.releaseNotes ?? null,
        }),
        ...createAboutHandlers({
          version: app.getVersion(),
          readChangelog: () => readBounded(changelogPath, MAX_CHANGELOG_BYTES),
          store: createWhatsNewStore({
            filePath: path.join(app.getPath('userData'), 'whats-new.json'),
            readFile: (file) => readFile(file, 'utf8'),
            writeFile: (file, text) => writeFile(file, text, 'utf8'),
            rename,
            log: (message, error) => console.warn(message, error),
          }),
          noticesPath,
          fileExists: (file) =>
            stat(file).then(
              (info) => info.isFile(),
              () => false,
            ),
          openPath: (file) => shell.openPath(file),
          openExternal: (url) => shell.openExternal(url),
          log: (message, error) => console.warn(message, error),
        }),
        ...createOptionsHandlers(options, {
          get: () => autoUpdate,
          set: async (enabled) => {
            autoUpdate = enabled
            await appSettings.writeAutoUpdate(enabled)
            return autoUpdate
          },
        }),
        ...createLaunchHandlers(launch),
        ...createScanHandlers({
          scanService,
          stat,
          volumeFor,
          addRecent: (root) => recent.add(root),
        }),
        ...createDriveHandlers({
          listDrives: listSystemDrives,
          driveDetails,
          listPlaces: () =>
            listPlaces({
              documentsPath: () => {
                try {
                  return app.getPath('documents')
                } catch {
                  return null
                }
              },
              env: process.env,
              isDirectory: (target) =>
                stat(target).then(
                  (info) => info.isDirectory(),
                  () => false,
                ),
              recent,
            }),
        }),
        ...createTreeHandlers({ scanService, refreshFolder }),
        ...createExportHandlers({
          scanService,
          dialog,
          getMainWindow: () => mainWindow,
          defaultFolder: () => {
            try {
              return app.getPath('documents')
            } catch {
              return app.getPath('home')
            }
          },
          showItemInFolder: (target) => shell.showItemInFolder(target),
        }),
        ...createIconHandlers({
          scanService,
          icons: {
            request: (targets) => getIconService().request(targets),
            knownFolders: () => getIconService().knownFolders(),
            newScan: () => iconService?.newScan(),
          },
        }),
        ...createShellHandlers({
          scanService,
          refreshFolder,
          openPath: (target) => shell.openPath(target),
          showItemInFolder: (target) => shell.showItemInFolder(target),
          writeClipboard: (text) => clipboard.writeText(text),
          readdir: (folder) => readdir(folder),
          mkdir: async (folder) => {
            await mkdir(folder)
          },
          showShellMenu: showContextMenuAt,
          deleteShellItems,
          emptyRecycleBin,
          userSid: currentUserSid,
          realPath: (target) =>
            new Promise((resolve, reject) =>
              realpath.native(target, (error, resolved) =>
                error ? reject(error) : resolve(resolved),
              ),
            ),
          pathExists: itemExists,
          watcher: itemWatcher,
          warn: (message, error) => console.warn(message, error),
        }),
      } satisfies IpcHandlerMap

      registerIpcHandlers(ipcMain, handlers, (event) =>
        isTrustedIpcSender(event, {
          mainWebContents: mainWindow?.webContents,
          isTrustedUrl,
        }),
      )

      mainWindow = createMainWindow({
        preloadPath,
        rendererRoot,
        devServerUrl,
        iconPath: devIconPath,
        isQuitting: () => quitting,
        onRendererReload: () => scanService.cancelActive(),
      })
      mainWindow.on('closed', () => {
        mainWindow = null
      })
      // A reload or navigation starts over: a request waits until the page asks for it again.
      watchRendererLifecycle(mainWindow.webContents, () => launch.rendererGone())
      void launch.handleArgv(process.argv)
      // The install folder may have changed (update, moved app): point the menu at this exe.
      if (app.isPackaged) options.repairExplorerMenu()

      await autoUpdateLoaded
      updater = createUpdater({
        autoUpdater,
        autoCheck: () => autoUpdate,
        isPackaged: app.isPackaged,
        selfTest: process.argv.includes(SELF_TEST_FLAG),
        version: app.getVersion(),
        send: sendEvent,
        schedule: (callback, ms) => {
          const timer = setTimeout(callback, ms)
          return () => clearTimeout(timer)
        },
        scheduleEvery: (callback, ms) => {
          const timer = setInterval(callback, ms)
          return () => clearInterval(timer)
        },
        log: (message, error) => console.warn(message, error),
      })
      updater.start()
      // A page that loads while an update is announced or downloading still gets its state.
      mainWindow.webContents.on('did-finish-load', () => {
        if (updater && updater.state.kind !== 'idle') sendEvent('update:state', updater.state)
      })
    })
    .catch(reportStartupError)
}
