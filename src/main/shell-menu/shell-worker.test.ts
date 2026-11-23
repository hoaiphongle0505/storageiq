import { describe, expect, it, vi } from 'vitest'
import { hideDestructiveVerbs, type MenuRoute } from './context-menu'
import { SHELL_FIRST_ID, STORAGEIQ_COMMAND_IDS } from './menu-commands'
import { ShellMenuError } from './shell-menu-error'
import type { BuildOptions, BuiltShellMenu, ShellNative } from './shell-native'
import type { WorkerReply, WorkerRequest } from './shell-worker-protocol'
import { runShellRequest } from './shell-worker'

type ShowRequest = Extract<WorkerRequest, { type: 'show' }>

const show = (paths: string[], overrides: Partial<ShowRequest> = {}): ShowRequest => ({
  type: 'show',
  id: 7,
  paths,
  x: 100,
  y: 200,
  extended: false,
  hideDestructive: false,
  ...overrides,
})

function fakeMenu(chosenId: number, verb: string | null = 'delete') {
  const calls: string[] = []
  const menu: BuiltShellMenu = {
    labels: vi.fn(() => ['&StorageIQ', '', 'Open']),
    track: vi.fn(() => {
      calls.push('track')
      return chosenId
    }),
    verb: vi.fn(() => verb),
    offsetOfVerb: vi.fn(() => 9),
    invoke: vi.fn(() => {
      calls.push('invoke')
    }),
    recycle: vi.fn(() => {
      calls.push('recycle')
    }),
    release: vi.fn(() => {
      calls.push('release')
    }),
  }
  return { menu, calls }
}

function fakeNative(menu: BuiltShellMenu, fallback?: BuiltShellMenu) {
  const routes: Array<{ route: MenuRoute; paths: readonly string[]; options: BuildOptions }> = []
  const native: ShellNative = {
    build: vi.fn((route, paths, options) => {
      routes.push({ route, paths, options })
      return menu
    }),
    buildFallback: vi.fn(() => fallback ?? menu),
  }
  return { native, routes }
}

function collect() {
  const replies: WorkerReply[] = []
  return { replies, post: (reply: WorkerReply) => replies.push(reply) }
}

describe('runShellRequest', () => {
  it('one path uses the single item route', () => {
    const { menu } = fakeMenu(0)
    const { native, routes } = fakeNative(menu)
    runShellRequest(native, show(['D:\\Data\\a.txt']), collect().post)
    expect(routes).toEqual([
      {
        route: 'single',
        paths: ['D:\\Data\\a.txt'],
        options: { extended: false, hideDestructive: false },
      },
    ])
  })

  it('paths in one folder use one parent with all child ids', () => {
    const { menu } = fakeMenu(0)
    const { native, routes } = fakeNative(menu)
    runShellRequest(
      native,
      show(['D:\\Data\\a.txt', 'D:\\Data\\b.txt', 'D:\\Data\\c.txt']),
      collect().post,
    )
    expect(routes.map((entry) => entry.route)).toEqual(['parent'])
    expect(routes[0]?.paths).toHaveLength(3)
  })

  it('paths in several folders use the default menu route', () => {
    const { menu } = fakeMenu(0)
    const { native, routes } = fakeNative(menu)
    runShellRequest(
      native,
      show(['D:\\Data\\a.txt', 'D:\\Other\\b.txt'], { extended: true }),
      collect().post,
    )
    expect(routes.map((entry) => entry.route)).toEqual(['default'])
    expect(routes[0]?.options.extended).toBe(true)
  })

  it('a failed default menu falls back to the StorageIQ menu with Delete', () => {
    const primary = fakeMenu(0)
    const fallback = fakeMenu(STORAGEIQ_COMMAND_IDS.delete)
    const { native } = fakeNative(primary.menu, fallback.menu)
    vi.mocked(native.build).mockImplementation(() => {
      throw new ShellMenuError('SHCreateDefaultContextMenu', 0x80004005)
    })
    const { replies, post } = collect()
    runShellRequest(native, show(['D:\\a\\1.txt', 'D:\\b\\2.txt']), post)
    expect(native.buildFallback).toHaveBeenCalledWith(['D:\\a\\1.txt', 'D:\\b\\2.txt'])
    expect(fallback.calls).toEqual(['track', 'recycle', 'release'])
    expect(replies).toEqual([
      { type: 'chosen', id: 7, choice: { kind: 'shell', verb: 'delete', changed: true } },
      { type: 'finished', id: 7, ok: true },
    ])
  })

  it('a menu that fails for another reason is reported as failed, not replaced', () => {
    const { menu } = fakeMenu(0)
    const { native } = fakeNative(menu)
    vi.mocked(native.build).mockImplementation(() => {
      throw new ShellMenuError('SHParseDisplayName', 0x80070002)
    })
    const { replies, post } = collect()
    runShellRequest(native, show(['D:\\a\\1.txt', 'D:\\b\\2.txt']), post)
    expect(native.buildFallback).not.toHaveBeenCalled()
    expect(replies).toEqual([
      { type: 'failed', id: 7, hresult: 0x80070002, step: 'SHParseDisplayName' },
    ])
  })

  it('hideDestructive removes delete, cut and rename', () => {
    const { menu } = fakeMenu(0)
    const { native, routes } = fakeNative(menu)
    runShellRequest(native, show(['C:\\'], { hideDestructive: true }), collect().post)
    expect(routes[0]?.options.hideDestructive).toBe(true)
    // The removal itself is the pure helper the native layer runs after QueryContextMenu.
    const ids = [0, 0x100, 0x101, 0x102]
    const verbs = ['open', 'cut', 'delete']
    const removed: number[] = []
    hideDestructiveVerbs({
      count: () => ids.length,
      idAt: (position) => ids[position] ?? 0,
      verbOf: (offset) => verbs[offset] ?? null,
      removeAt: (position) => {
        removed.push(position)
      },
    })
    expect(removed).toEqual([3, 2])
  })

  it('chosen is posted before the command runs', () => {
    const { menu, calls } = fakeMenu(SHELL_FIRST_ID + 9, 'delete')
    const { native } = fakeNative(menu)
    const order: string[] = []
    runShellRequest(native, show(['D:\\Data\\a.txt']), (reply) => {
      order.push(reply.type)
      if (reply.type === 'chosen') expect(calls).toEqual(['track'])
    })
    expect(order).toEqual(['chosen', 'finished'])
    expect(calls).toEqual(['track', 'invoke', 'release'])
    expect(menu.invoke).toHaveBeenCalledWith(9, 100, 200)
  })

  it('dismissed and StorageIQ items finish at once without running anything', () => {
    for (const [id, choice] of [
      [0, { kind: 'dismissed' }],
      [STORAGEIQ_COMMAND_IDS['copy-path'], { kind: 'storageiq', item: 'copy-path' }],
    ] as const) {
      const { menu } = fakeMenu(id)
      const { native } = fakeNative(menu)
      const { replies, post } = collect()
      runShellRequest(native, show(['D:\\Data\\a.txt']), post)
      expect(replies).toEqual([
        { type: 'chosen', id: 7, choice },
        { type: 'finished', id: 7, ok: true },
      ])
      expect(menu.invoke).not.toHaveBeenCalled()
      expect(menu.release).toHaveBeenCalledTimes(1)
    }
  })

  it('finished carries the hresult of a failed command', () => {
    const { menu } = fakeMenu(SHELL_FIRST_ID + 9)
    vi.mocked(menu.invoke).mockImplementation(() => {
      throw new ShellMenuError('InvokeCommand', 0x80270000)
    })
    const { native } = fakeNative(menu)
    const { replies, post } = collect()
    runShellRequest(native, show(['D:\\Data\\a.txt']), post)
    expect(replies.at(-1)).toEqual({
      type: 'finished',
      id: 7,
      ok: false,
      hresult: 0x80270000,
      step: 'InvokeCommand',
    })
  })

  it('everything is released when the command throws', () => {
    const { menu } = fakeMenu(SHELL_FIRST_ID + 9)
    vi.mocked(menu.invoke).mockImplementation(() => {
      throw new Error('boom')
    })
    const { native } = fakeNative(menu)
    const { replies, post } = collect()
    runShellRequest(native, show(['D:\\Data\\a.txt']), post)
    expect(menu.release).toHaveBeenCalledTimes(1)
    expect(replies.at(-1)).toMatchObject({ type: 'finished', ok: false, hresult: 0x80004005 })
  })

  it('the menu is released when tracking throws', () => {
    const { menu } = fakeMenu(0)
    vi.mocked(menu.track).mockImplementation(() => {
      throw new Error('TrackPopupMenuEx failed')
    })
    const { native } = fakeNative(menu)
    const { replies, post } = collect()
    runShellRequest(native, show(['D:\\Data\\a.txt']), post)
    expect(menu.release).toHaveBeenCalledTimes(1)
    expect(replies).toEqual([{ type: 'failed', id: 7, hresult: 0x80004005, step: 'track' }])
  })
})
