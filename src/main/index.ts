import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
import { createAppHandlers } from './ipc/app-handlers'
import { createDriveHandlers } from './ipc/drive-handlers'
import { type IpcHandlerMap, registerIpcHandlers } from './ipc/register'
import { createScanHandlers } from './ipc/scan-handlers'
import { createEventSender } from './ipc/send-event'
import { createItemWatcher } from './ipc/item-watcher'
import { createShellHandlers, itemExists } from './ipc/shell-handlers'
import { createFolderRefresher, createTreeHandlers } from './ipc/tree-handlers'
import { createRecentScans, listPlaces, RECENT_SCANS_FILE } from './places/places'
import { createScanService, type ScannerChild } from './scan/scan-service'
import { hardenWebContents } from './security/harden-web-contents'
import { isTrustedRendererUrl } from './security/trusted-url'
import { isTrustedIpcSender } from './security/trusted-sender'
import { runSelfTest, SELF_TEST_FLAG, type SelfTestScan } from './self-test'
import {
  probeShellMenu,
  type ShellMenuChoice,
  type ShellMenuNative,
  showShellMenu,
} from './shell-menu/context-menu'
import { createWinShellMenu } from './shell-menu/win-shell-menu'
import { createMainWindow } from './window'

const APP_USER_MODEL_ID = 'io.github.storageiq.app'
const rendererRoot = path.join(__dirname, '../renderer')
const preloadPath = path.join(__dirname, '../preload/index.js')
const scannerPath = path.join(__dirname, 'scanner.js')
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
const isTrustedUrl = (url: string) => isTrustedRendererUrl(url, { rendererRoot, devServerUrl })

let mainWindow: BrowserWindow | null = null
let quitting = false
let driveApi: Promise<DriveApi> | null = null
let shellMenuNative: Promise<ShellMenuNative> | null = null

/** Loads koffi on first use; a failed load is retried on the next call. */
function getDriveApi(): Promise<DriveApi> {
  driveApi ??= createKoffiDriveApi().catch((error: unknown) => {
    driveApi = null
    throw error
  })
  return driveApi
}

function getShellMenu(): Promise<ShellMenuNative> {
  shellMenuNative ??= createWinShellMenu().catch((error: unknown) => {
    shellMenuNative = null
    throw error
  })
  return shellMenuNative
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

function windowHandle(window: BrowserWindow | null): bigint {
  return window === null ? 0n : window.getNativeWindowHandle().readBigUInt64LE(0)
}

/** Shows the Explorer menu at window CSS pixel `x`, `y` (converted to screen pixels). */
async function showContextMenuAt(
  target: string,
  x: number,
  y: number,
  extended: boolean,
): Promise<ShellMenuChoice> {
  const window = mainWindow
  if (window === null || window.isDestroyed()) return { kind: 'dismissed' }
  const native = await getShellMenu()
  const bounds = window.getContentBounds()
  const point = screen.dipToScreenPoint({ x: bounds.x + x, y: bounds.y + y })
  return showShellMenu(native, {
    hwnd: windowHandle(window),
    path: target,
    x: Math.round(point.x),
    y: Math.round(point.y),
    extended,
  })
}

function forkScanner(): ScannerChild {
  const child = utilityProcess.fork(scannerPath, [], { serviceName: SCANNER_SERVICE_NAME })
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
  app.setPath('userData', path.join(app.getPath('appData'), 'StorageIQ-dev'))
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
        probeShellMenu: async (target) => probeShellMenu(await getShellMenu(), 0n, target),
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
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  hardenWebContents(app, isTrustedUrl)
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => {
    quitting = true
    itemWatcher.cancelAll()
    scanService.dispose() // kills the scanner; no event is sent during quit
  })

  // E2E only (unpackaged + STORAGEIQ_TEST_HOOKS=1): list the Explorer menu's labels for a path
  // without showing it, because Playwright cannot drive a native menu.
  if (!app.isPackaged && process.env['STORAGEIQ_TEST_HOOKS'] === '1') {
    Object.assign(globalThis, {
      __storageiqProbeShellMenu: async (target: string) =>
        probeShellMenu(await getShellMenu(), windowHandle(mainWindow), target),
    })
  }

  app
    .whenReady()
    .then(() => {
      app.setAppUserModelId(APP_USER_MODEL_ID)
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
          },
        }),
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
        isQuitting: () => quitting,
        onRendererReload: () => scanService.cancelActive(),
      })
      mainWindow.on('closed', () => {
        mainWindow = null
      })
    })
    .catch(reportStartupError)
}
