import path from 'node:path'
import { BrowserWindow, nativeTheme } from 'electron'
import { isTrustedRendererUrl } from './security/trusted-url'
import { createMainWindowOptions } from './window-options'

export interface MainWindowConfig {
  preloadPath: string
  rendererRoot: string
  devServerUrl?: string
}

export function createMainWindow(config: MainWindowConfig): BrowserWindow {
  const window = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: config.preloadPath,
      dark: nativeTheme.shouldUseDarkColors,
    }),
  )

  const isTrusted = (url: string) =>
    isTrustedRendererUrl(url, {
      rendererRoot: config.rendererRoot,
      devServerUrl: config.devServerUrl,
    })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    if (!isTrusted(event.url)) {
      event.preventDefault()
    }
  })
  window.once('ready-to-show', () => window.show())

  const load = config.devServerUrl
    ? window.loadURL(config.devServerUrl)
    : window.loadFile(path.join(config.rendererRoot, 'index.html'))
  load.catch((error: unknown) => {
    console.error('StorageIQ: failed to load the renderer', error)
  })

  return window
}
