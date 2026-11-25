import type { BrowserWindowConstructorOptions } from 'electron'

/** Must stay equal to the `surface-app` colours in `design/tokens.json`. */
export const WINDOW_BACKGROUND = { light: '#f5f3ef', dark: '#151a21' } as const

export function createMainWindowOptions(input: {
  preloadPath: string
  dark: boolean
  /** The window icon for unpackaged runs; a packaged build uses the icon embedded in the exe. */
  iconPath?: string
}): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'StorageIQ',
    ...(input.iconPath === undefined ? {} : { icon: input.iconPath }),
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
