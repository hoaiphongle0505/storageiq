import path from 'node:path'
import { app, type BrowserWindow, dialog, ipcMain, Menu, session } from 'electron'
import { createAppHandlers } from './ipc/app-handlers'
import { registerIpcHandlers } from './ipc/register'
import { hardenWebContents } from './security/harden-web-contents'
import { isTrustedRendererUrl } from './security/trusted-url'
import { isTrustedIpcSender } from './security/trusted-sender'
import { createMainWindow } from './window'

const APP_USER_MODEL_ID = 'io.github.storageiq.app'
const rendererRoot = path.join(__dirname, '../renderer')
const preloadPath = path.join(__dirname, '../preload/index.js')
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
const isTrustedUrl = (url: string) => isTrustedRendererUrl(url, { rendererRoot, devServerUrl })

let mainWindow: BrowserWindow | null = null

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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
  hardenWebContents(app, isTrustedUrl)
  app.on('window-all-closed', () => app.quit())

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

      registerIpcHandlers(
        ipcMain,
        createAppHandlers({
          app,
          dialog,
          getMainWindow: () => mainWindow,
          runtime: {
            platform: process.platform,
            arch: process.arch,
            electronVersion: process.versions.electron,
          },
        }),
        (event) =>
          isTrustedIpcSender(event, {
            mainWebContents: mainWindow?.webContents,
            isTrustedUrl,
          }),
      )

      mainWindow = createMainWindow({ preloadPath, rendererRoot, devServerUrl })
      mainWindow.on('closed', () => {
        mainWindow = null
      })
    })
    .catch(reportStartupError)
}
