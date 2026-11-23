import { describe, expect, it, vi } from 'vitest'
import {
  type BuiltShellMenu,
  probeShellMenu,
  type ShellMenuNative,
  showShellMenu,
} from './context-menu'
import { SHELL_FIRST_ID, STORAGEIQ_COMMAND_IDS } from './menu-commands'

function fakeNative(chosenId: number, verb: string | null = 'delete') {
  const menu: BuiltShellMenu = {
    labels: vi.fn(() => ['&StorageIQ', 'New &folder\tCtrl+N', '', '&Open', 'P&roperties']),
    track: vi.fn(() => chosenId),
    verb: vi.fn(() => verb),
    invoke: vi.fn(),
    release: vi.fn(),
  }
  const native: ShellMenuNative = { build: vi.fn(() => menu) }
  return { native, menu }
}

const request = { hwnd: 42n, path: 'D:\\Data\\a.jpg', x: 300, y: 200, extended: false }

describe('showShellMenu', () => {
  it('builds the menu for the path and returns dismissed when nothing is chosen', () => {
    const { native, menu } = fakeNative(0)
    expect(showShellMenu(native, request)).toEqual({ kind: 'dismissed' })
    expect(native.build).toHaveBeenCalledWith(42n, 'D:\\Data\\a.jpg', false)
    expect(menu.track).toHaveBeenCalledWith(300, 200)
    expect(menu.invoke).not.toHaveBeenCalled()
    expect(menu.release).toHaveBeenCalledTimes(1)
  })

  it('returns StorageIQ’s item without invoking the shell', () => {
    const { native, menu } = fakeNative(STORAGEIQ_COMMAND_IDS['copy-path'])
    expect(showShellMenu(native, request)).toEqual({ kind: 'storageiq', item: 'copy-path' })
    expect(menu.invoke).not.toHaveBeenCalled()
  })

  it('invokes a shell item by its offset and reports whether it may change files', () => {
    const { native, menu } = fakeNative(SHELL_FIRST_ID + 9, 'delete')
    expect(showShellMenu(native, { ...request, extended: true })).toEqual({
      kind: 'shell',
      verb: 'delete',
      changed: true,
    })
    expect(menu.verb).toHaveBeenCalledWith(9)
    expect(menu.invoke).toHaveBeenCalledWith(9, 300, 200)
  })

  it('reports read-only shell verbs as unchanged', () => {
    const { native } = fakeNative(SHELL_FIRST_ID + 1, 'properties')
    expect(showShellMenu(native, request)).toEqual({
      kind: 'shell',
      verb: 'properties',
      changed: false,
    })
  })

  it('releases the menu even when the shell command fails', () => {
    const { native, menu } = fakeNative(SHELL_FIRST_ID + 2)
    vi.mocked(menu.invoke).mockImplementation(() => {
      throw new Error('InvokeCommand failed')
    })
    expect(() => showShellMenu(native, request)).toThrow('InvokeCommand failed')
    expect(menu.release).toHaveBeenCalledTimes(1)
  })
})

describe('probeShellMenu', () => {
  it('returns the labels and destroys the menu without showing it', () => {
    const { native, menu } = fakeNative(0)
    expect(probeShellMenu(native, 0n, 'C:\\')).toEqual([
      '&StorageIQ',
      'New &folder\tCtrl+N',
      '',
      '&Open',
      'P&roperties',
    ])
    expect(menu.track).not.toHaveBeenCalled()
    expect(menu.release).toHaveBeenCalledTimes(1)
  })
})
