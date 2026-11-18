import type { BrowserWindowConstructorOptions } from 'electron'

/** Must stay equal to the `--surface-app` tokens in `src/renderer/src/styles/global.css`. */
export const WINDOW_BACKGROUND = { light: '#f6f7f7', dark: '#161a1b' } as const

export function createMainWindowOptions(input: {
  preloadPath: string
  dark: boolean
}): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 780,
    minWidth: 880,
    minHeight: 560,
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
      spellcheck: false,
    },
  }
}
