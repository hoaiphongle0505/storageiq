import path from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme } from 'electron'
import { shouldTreatAsFatalLoadFailure } from './load-failure'
import {
  decideRenderProcessGone,
  RENDERER_GONE_QUIT_MESSAGE,
  RENDERER_GONE_RELOAD_MESSAGE,
  RENDERER_GONE_TITLE,
} from './render-process-gone'
import { createMainWindowOptions, WINDOW_BACKGROUND } from './window-options'

export interface MainWindowConfig {
  preloadPath: string
  rendererRoot: string
  devServerUrl?: string
  /** True once the app has started quitting; renderer exits during quit are ignored. */
  isQuitting(): boolean
  /** Called just before the window reloads after a renderer crash. */
  onRendererReload?(): void
}

let failing = false

function failStartup(detail: string): void {
  if (failing) return // did-fail-load and the load promise both report the same failure
  failing = true
  dialog.showErrorBox(
    'StorageIQ could not start',
    `StorageIQ could not load its window and will close.\n\n${detail}`,
  )
  app.quit()
}

export function createMainWindow(config: MainWindowConfig): BrowserWindow {
  const window = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: config.preloadPath,
      dark: nativeTheme.shouldUseDarkColors,
    }),
  )
  let loaded = false
  let reloadedAfterCrash = false

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (shouldTreatAsFatalLoadFailure(errorCode, isMainFrame)) {
        failStartup(errorDescription)
      }
    },
  )
  window.webContents.on('did-finish-load', () => {
    loaded = true
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    const action = decideRenderProcessGone({
      reason: details.reason,
      quitting: config.isQuitting(),
      loaded,
      reloadedAfterCrash,
    })
    switch (action) {
      case 'ignore':
        return
      case 'fail-startup':
        failStartup(`The window process stopped unexpectedly (${details.reason}).`)
        return
      case 'reload':
        reloadedAfterCrash = true
        dialog.showErrorBox(RENDERER_GONE_TITLE, RENDERER_GONE_RELOAD_MESSAGE)
        config.onRendererReload?.()
        window.webContents.reload()
        return
      case 'quit':
        dialog.showErrorBox(RENDERER_GONE_TITLE, RENDERER_GONE_QUIT_MESSAGE)
        app.quit()
        return
    }
  })
  const syncBackground = () =>
    window.setBackgroundColor(
      nativeTheme.shouldUseDarkColors ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light,
    )
  nativeTheme.on('updated', syncBackground)
  window.once('closed', () => nativeTheme.off('updated', syncBackground))
  window.once('ready-to-show', () => window.show())

  const load = config.devServerUrl
    ? window.loadURL(config.devServerUrl)
    : window.loadFile(path.join(config.rendererRoot, 'index.html'))
  load.catch((error: unknown) => {
    failStartup(error instanceof Error ? error.message : String(error))
  })

  return window
}
