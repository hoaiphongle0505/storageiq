import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { type AppHandlerDeps, createAppHandlers } from './app-handlers'
import { InvalidIpcArgumentsError } from './parse-args'

const event = {} as IpcMainInvokeEvent
const fakeWindow = {} as BrowserWindow

function setup(overrides: Partial<AppHandlerDeps> = {}) {
  const showOpenDialog = vi.fn<AppHandlerDeps['dialog']['showOpenDialog']>()
  const quit = vi.fn()
  const installUpdate = vi.fn()
  const deps: AppHandlerDeps = {
    app: { getName: () => 'StorageIQ', getVersion: () => '0.1.0', quit },
    dialog: { showOpenDialog },
    getMainWindow: () => fakeWindow,
    runtime: { platform: 'win32', arch: 'x64', electronVersion: '38.0.0' },
    installUpdate,
    ...overrides,
  }
  return { handlers: createAppHandlers(deps), showOpenDialog, quit, installUpdate }
}

describe('app:quit', () => {
  it('takes no arguments and quits the app', () => {
    const { handlers, quit } = setup()
    expect(() => handlers['app:quit'].parseArgs(['now'])).toThrow(InvalidIpcArgumentsError)
    handlers['app:quit'].handle(event)
    expect(quit).toHaveBeenCalledTimes(1)
  })
})

describe('update:install', () => {
  it('update:install calls installUpdate', () => {
    const { handlers, installUpdate } = setup()
    handlers['update:install'].handle(event)
    expect(installUpdate).toHaveBeenCalledTimes(1)
  })

  it('rejects extra arguments', () => {
    const { handlers } = setup()
    expect(() => handlers['update:install'].parseArgs(['x'])).toThrow(InvalidIpcArgumentsError)
  })
})

describe('app:get-info', () => {
  it('reports name, version and runtime details', async () => {
    const { handlers } = setup()
    await expect(Promise.resolve(handlers['app:get-info'].handle(event))).resolves.toEqual({
      name: 'StorageIQ',
      version: '0.1.0',
      platform: 'win32',
      arch: 'x64',
      electronVersion: '38.0.0',
    })
  })
})

describe('dialog:select-folder', () => {
  it('returns the folder the user picked', async () => {
    const { handlers, showOpenDialog } = setup()
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\Users\\Ana\\Downloads'] })

    await expect(Promise.resolve(handlers['dialog:select-folder'].handle(event))).resolves.toEqual({
      canceled: false,
      path: 'C:\\Users\\Ana\\Downloads',
    })
    expect(showOpenDialog).toHaveBeenCalledWith(
      fakeWindow,
      expect.objectContaining({ properties: expect.arrayContaining(['openDirectory']) }),
    )
  })

  it('reports a cancel when the user dismisses the dialog', async () => {
    const { handlers, showOpenDialog } = setup()
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(Promise.resolve(handlers['dialog:select-folder'].handle(event))).resolves.toEqual({
      canceled: true,
    })
  })

  it('reports a cancel without opening a dialog when no window exists', async () => {
    const { handlers, showOpenDialog } = setup({ getMainWindow: () => null })
    await expect(Promise.resolve(handlers['dialog:select-folder'].handle(event))).resolves.toEqual({
      canceled: true,
    })
    expect(showOpenDialog).not.toHaveBeenCalled()
  })
})

describe('argument validation', () => {
  it('both channels reject any argument', () => {
    const { handlers } = setup()
    expect(() => handlers['app:get-info'].parseArgs(['x'])).toThrow(InvalidIpcArgumentsError)
    expect(() => handlers['dialog:select-folder'].parseArgs([{}])).toThrow(InvalidIpcArgumentsError)
  })
})
