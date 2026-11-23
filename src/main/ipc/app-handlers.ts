import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from 'electron'
import { noArgs } from './parse-args'
import type { IpcHandlerMap } from './register'

export interface AppHandlerDeps {
  app: { getName(): string; getVersion(): string; quit(): void }
  dialog: {
    showOpenDialog(
      window: BrowserWindow,
      options: OpenDialogOptions,
    ): Promise<OpenDialogReturnValue>
  }
  getMainWindow(): BrowserWindow | null
  runtime: { platform: string; arch: string; electronVersion: string }
}

export type AppHandlers = Pick<IpcHandlerMap, 'app:get-info' | 'app:quit' | 'dialog:select-folder'>

export function createAppHandlers(deps: AppHandlerDeps): AppHandlers {
  return {
    'app:get-info': {
      parseArgs: noArgs,
      handle: () => ({
        name: deps.app.getName(),
        version: deps.app.getVersion(),
        ...deps.runtime,
      }),
    },

    'app:quit': {
      parseArgs: noArgs,
      handle: () => {
        deps.app.quit()
      },
    },

    'dialog:select-folder': {
      parseArgs: noArgs,
      handle: async () => {
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
    },
  }
}
