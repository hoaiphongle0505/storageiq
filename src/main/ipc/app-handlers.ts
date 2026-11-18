import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import type { IpcHandlerMap } from './register'

export interface AppHandlerDeps {
  app: { getName(): string; getVersion(): string }
  dialog: {
    showOpenDialog(
      window: BrowserWindow,
      options: OpenDialogOptions,
    ): Promise<OpenDialogReturnValue>
  }
  getMainWindow(): BrowserWindow | null
  runtime: { platform: string; arch: string; electronVersion: string }
}

export function createAppHandlers(deps: AppHandlerDeps): IpcHandlerMap {
  return {
    'app:get-info': () => ({
      name: deps.app.getName(),
      version: deps.app.getVersion(),
      ...deps.runtime,
    }),

    'dialog:select-folder': async () => {
      const window = deps.getMainWindow()
      if (!window) {
        return { canceled: true }
      }
      const result = await deps.dialog.showOpenDialog(window, {
        title: 'Choose a folder',
        properties: ['openDirectory', 'dontAddToRecent'],
      })
      const [folder] = result.filePaths
      if (result.canceled || folder === undefined) {
        return { canceled: true }
      }
      return { canceled: false, path: folder }
    },
  }
}
