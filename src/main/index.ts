import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { app, type BrowserWindow, dialog, ipcMain, Menu, session, utilityProcess } from 'electron'
import type { ScanDone, ScanFailed } from '@shared/scan-types'
import { SCANNER_SERVICE_NAME } from '@shared/scanner-protocol'
import type { DriveApi } from './drives/drive-api'
import { createKoffiDriveApi } from './drives/koffi-drive-api'
import { listDrives } from './drives/list-drives'
import { createAppHandlers } from './ipc/app-handlers'
import { createDriveHandlers } from './ipc/drive-handlers'
import { type IpcHandlerMap, registerIpcHandlers } from './ipc/register'
import { createScanHandlers } from './ipc/scan-handlers'
import { createEventSender } from './ipc/send-event'
import { createScanService, type ScannerChild } from './scan/scan-service'
import { hardenWebContents } from './security/harden-web-contents'
import { isTrustedRendererUrl } from './security/trusted-url'
import { isTrustedIpcSender } from './security/trusted-sender'
import { runSelfTest, SELF_TEST_FLAG } from './self-test'
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

/** Loads koffi on first use; a failed load is retried on the next call. */
function getDriveApi(): Promise<DriveApi> {
  driveApi ??= createKoffiDriveApi().catch((error: unknown) => {
    driveApi = null
    throw error
  })
  return driveApi
}

async function listSystemDrives() {
  return listDrives(await getDriveApi())
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

const scanService = createScanService({
  forkScanner,
  sendEvent: createEventSender(() => mainWindow),
  createScanId: () => randomUUID(),
})

/** Self-test only: one scan in a fresh scanner process, resolved with its final event. */
function scanOnce(root: string): Promise<ScanDone | ScanFailed> {
  return new Promise((resolve) => {
    const service = createScanService({
      forkScanner,
      createScanId: () => randomUUID(),
      sendEvent: (channel, payload) => {
        if (channel === 'scan:progress') return
        service.dispose()
        resolve(payload as ScanDone | ScanFailed)
      },
    })
    service.start(root)
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
  // No window, no single-instance lock: list drives, run one scan, exit with a status code.
  // A temp userData keeps this run away from a live instance's profile.
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
    scanService.dispose() // kills the scanner; no event is sent during quit
  })

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
        ...createScanHandlers({ scanService, stat }),
        ...createDriveHandlers({ listDrives: listSystemDrives }),
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
