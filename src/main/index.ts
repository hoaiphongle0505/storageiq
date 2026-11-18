import path from 'node:path'
import { app, type BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { createAppHandlers } from './ipc/app-handlers'
import { registerIpcHandlers } from './ipc/register'
import { isTrustedRendererUrl } from './security/trusted-url'
import { createMainWindow } from './window'

const APP_USER_MODEL_ID = 'io.github.storageiq.app'
const rendererRoot = path.join(__dirname, '../renderer')
const preloadPath = path.join(__dirname, '../preload/index.js')
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

let mainWindow: BrowserWindow | null = null

function focusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  app.on('window-all-closed', () => app.quit())

  void app.whenReady().then(() => {
    app.setAppUserModelId(APP_USER_MODEL_ID)
    if (app.isPackaged) {
      Menu.setApplicationMenu(null)
    }

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
      (url) => isTrustedRendererUrl(url, { rendererRoot, devServerUrl }),
    )

    mainWindow = createMainWindow({ preloadPath, rendererRoot, devServerUrl })
    mainWindow.on('closed', () => {
      mainWindow = null
    })
  })
}
