import type { BrowserWindowConstructorOptions } from 'electron'

/** Must stay equal to the `surface-app` colours in `design/tokens.json`. */
export const WINDOW_BACKGROUND = { light: '#f6f7f7', dark: '#161a1b' } as const

export function createMainWindowOptions(input: {
  preloadPath: string
  dark: boolean
}): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'StorageIQ',
    backgroundColor: input.dark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light,
    autoHideMenuBar: true,
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      nodeIntegrationInSubFrames: false,
      spellcheck: false,
    },
  }
}
