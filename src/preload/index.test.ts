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

  it('each new method invokes its channel with the documented arguments', async () => {
    const { ipcRenderer } = await import('electron')
    const call = (name: string, ...args: unknown[]) =>
      (exposed[name] as unknown as (...a: unknown[]) => Promise<unknown>)(...args)
    await call('getUpdateState')
    await call('checkForUpdates')
    await call('downloadUpdate')
    await call('getReleaseNotes')
    await call('getChangelog')
    await call('openNotices')
    await call('openLink', 'issues')
    await call('getWhatsNewDue')
    await call('markWhatsNewSeen')
    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual([
      ['update:get-state'],
      ['update:check'],
      ['update:download'],
      ['update:get-release-notes'],
      ['app:get-changelog'],
      ['app:open-notices'],
      ['app:open-link', 'issues'],
      ['app:get-whats-new-due'],
      ['app:mark-whats-new-seen'],
    ])
  })

  it('onUpdateState subscribes to update:state and returns an unsubscribe', () => {
    const received: unknown[] = []
    const unsubscribe = (
      exposed['onUpdateState'] as unknown as (cb: (p: unknown) => void) => () => void
    )((payload) => received.push(payload))
    const [forward] = listeners.get('update:state') ?? []
    forward?.({ sender: 'leaky' }, { kind: 'available', version: '0.2.0' })
    expect(received).toEqual([{ kind: 'available', version: '0.2.0' }])

    unsubscribe()
    expect(listeners.get('update:state')).toEqual([])
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
    await (exposed['deleteNodes'] as unknown as (...args: unknown[]) => Promise<unknown>)(
      'scan-1',
      ['d1'],
      true,
    )
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('shell:delete', 'scan-1', ['d1'], true)
    await (exposed['copyNodePath'] as unknown as (...args: unknown[]) => Promise<unknown>)(
      'scan-1',
      ['d1', 'f2'],
    )
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('clipboard:copy-path', 'scan-1', ['d1', 'f2'])
  })

  it('exposes copyNodePath, and copyText that sends one string and nothing else', async () => {
    const { ipcRenderer } = await import('electron')
    expect(typeof exposed['copyNodePath']).toBe('function')
    expect(exposed['writeClipboardText']).toBeUndefined()
    await (exposed['copyText'] as unknown as (...args: unknown[]) => Promise<unknown>)('a,b\r\n')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('clipboard:copy-text', 'a,b\r\n')
  })

  it('the side-view calls send only ids and the Mode', async () => {
    const { ipcRenderer } = await import('electron')
    const call = (name: string, ...args: unknown[]) =>
      (exposed[name] as unknown as (...a: unknown[]) => Promise<unknown>)(...args)
    await call('getTopFiles', 'scan-1', 'd1', 'allocated')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('side:top-files', 'scan-1', 'd1', 'allocated')
    await call('getTypeBreakdown', 'scan-1', 'd1')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('side:types', 'scan-1', 'd1')
    await call('getAgeBreakdown', 'scan-1', 'f2')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('side:age', 'scan-1', 'f2')
  })

  it('the export calls send ids and a format, never a path', async () => {
    const { ipcRenderer } = await import('electron')
    const call = (name: string, ...args: unknown[]) =>
      (exposed[name] as unknown as (...a: unknown[]) => Promise<unknown>)(...args)
    await call('exportTree', 'scan-1', 'd1', 'xlsx')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('export:run', 'scan-1', 'd1', 'xlsx')
    await call('showExport')
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith('shell:show-export')
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

  it('exposes the five option and launch functions', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.invoke).mockClear()
    const call = (name: string, ...args: unknown[]) =>
      (exposed[name] as unknown as (...a: unknown[]) => Promise<unknown>)(...args)
    await call('getOptionsState')
    await call('setExplorerMenu', true)
    await call('setRunAsAdmin', false)
    await call('takeLaunchRequest')
    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual([
      ['options:get-state'],
      ['options:set-explorer-menu', true],
      ['options:set-run-as-admin', false],
      ['launch:take-request'],
    ])
    expect(typeof exposed['onLaunchRequest']).toBe('function')
  })

  it('onLaunchRequest returns an unsubscribe', () => {
    const received: unknown[] = []
    const unsubscribe = (
      exposed['onLaunchRequest'] as unknown as (cb: (p: unknown) => void) => () => void
    )((payload) => received.push(payload))
    const [forward] = listeners.get('launch:request') ?? []
    forward?.({ sender: 'leaky' }, { kind: 'scan', path: 'D:\\Data' })
    expect(received).toEqual([{ kind: 'scan', path: 'D:\\Data' }])
    unsubscribe()
    expect(listeners.get('launch:request')).toEqual([])
  })
})
