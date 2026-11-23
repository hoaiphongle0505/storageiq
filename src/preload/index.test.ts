import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (event: unknown, ...args: unknown[]) => void

const listeners = new Map<string, Listener[]>()
let exposed: Record<string, (...args: never[]) => unknown> = {}

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: Record<string, (...args: never[]) => unknown>) => {
      exposed = api
    },
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: (channel: string, listener: Listener) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
    },
    removeListener: (channel: string, listener: Listener) => {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((entry) => entry !== listener),
      )
    },
  },
}))

describe('preload bridge', () => {
  beforeEach(async () => {
    listeners.clear()
    vi.resetModules()
    await import('./index')
  })

  it('onScanRestarted subscribes to scan:restarted and unsubscribes', () => {
    const received: unknown[] = []
    const unsubscribe = (
      exposed['onScanRestarted'] as unknown as (cb: (p: unknown) => void) => () => void
    )((payload) => received.push(payload))
    const [forward] = listeners.get('scan:restarted') ?? []
    forward?.({ sender: 'leaky' }, { scanId: 'scan-2', root: 'D:\\Data' })
    expect(received).toEqual([{ scanId: 'scan-2', root: 'D:\\Data' }])

    unsubscribe()
    expect(listeners.get('scan:restarted')).toEqual([])
  })

  it('installUpdate invokes update:install with no arguments', async () => {
    const { ipcRenderer } = await import('electron')
    await (exposed['installUpdate'] as unknown as () => Promise<void>)()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('update:install')
  })

  it('onUpdateReady subscribes to update:ready and returns an unsubscribe', () => {
    const received: unknown[] = []
    const unsubscribe = (
      exposed['onUpdateReady'] as unknown as (cb: (p: unknown) => void) => () => void
    )((payload) => received.push(payload))
    const [forward] = listeners.get('update:ready') ?? []
    forward?.({ sender: 'leaky' }, { version: '0.2.0' })
    expect(received).toEqual([{ version: '0.2.0' }])

    unsubscribe()
    expect(listeners.get('update:ready')).toEqual([])
  })

  it('sends the list of node ids for the menu and for copying paths', async () => {
    const { ipcRenderer } = await import('electron')
    await (exposed['showContextMenu'] as unknown as (...args: unknown[]) => Promise<unknown>)(
      'scan-1',
      ['d1', 'f2'],
      10,
      20,
      false,
    )
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(
      'shell:context-menu',
      'scan-1',
      ['d1', 'f2'],
      10,
      20,
      false,
    )
    await (exposed['copyNodePath'] as unknown as (...args: unknown[]) => Promise<unknown>)(
      'scan-1',
      ['d1', 'f2'],
    )
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('clipboard:copy-path', 'scan-1', ['d1', 'f2'])
  })

  it('exposes copyNodePath and no free-text clipboard writer', () => {
    expect(typeof exposed['copyNodePath']).toBe('function')
    expect(exposed['writeClipboardText']).toBeUndefined()
  })

  it('getIcons and getTypeIcons send only ids and type keys', async () => {
    const { ipcRenderer } = await import('electron')
    await (exposed['getIcons'] as unknown as (...args: unknown[]) => Promise<unknown>)('scan-1', [
      'f1',
      'd2',
    ])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('icons:for-nodes', 'scan-1', ['f1', 'd2'])
    await (exposed['getTypeIcons'] as unknown as (...args: unknown[]) => Promise<unknown>)([
      'dir',
      'ext:txt',
    ])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('icons:for-types', ['dir', 'ext:txt'])
  })
})
