import { describe, expect, it, vi } from 'vitest'
import { hideDestructiveVerbs, type MenuRoute } from './context-menu'
import { SHELL_FIRST_ID, STORAGEIQ_COMMAND_IDS } from './menu-commands'
import { ShellMenuError } from './shell-menu-error'
import type { BuildOptions, BuiltShellMenu, ShellNative } from './shell-native'
import type { WorkerReply, WorkerRequest } from './shell-worker-protocol'
import { runDeleteRequest, runEmptyBinRequest, runShellRequest } from './shell-worker'

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
    ownerHandle: vi.fn(() => '4242'),
    invoke: vi.fn(() => {
      calls.push('invoke')
    }),
    invokeDelete: vi.fn((permanent: boolean) => {
      calls.push(permanent ? 'delete-permanent' : 'delete')
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
    emptyRecycleBin: vi.fn(),
  }
  return { native, routes }
}

function collect() {
  const replies: WorkerReply[] = []
  // `tracking` (owner window for quit) has its own test.
  return {
    replies,
    post: (reply: WorkerReply) => {
      if (reply.type !== 'tracking') replies.push(reply)
    },
  }
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
      if (reply.type !== 'tracking') order.push(reply.type)
      if (reply.type === 'chosen') expect(calls).toEqual(['track'])
    })
    expect(order).toEqual(['chosen', 'finished'])
    expect(calls).toEqual(['track', 'invoke', 'release'])
    expect(menu.invoke).toHaveBeenCalledWith(9, 100, 200)
  })

  it('tells main the owner window before the popup opens', () => {
    const { menu, calls } = fakeMenu(0)
    const { native } = fakeNative(menu)
    const order: string[] = []
    runShellRequest(native, show(['D:\\Data\\a.txt']), (reply) => {
      order.push(reply.type)
      if (reply.type === 'tracking') {
        expect(reply.hwnd).toBe('4242')
        expect(calls).toEqual([])
      }
    })
    expect(order.slice(0, 2)).toEqual(['tracking', 'chosen'])
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

describe('runDeleteRequest', () => {
  const del = (
    paths: string[],
    permanent: boolean,
  ): Extract<WorkerRequest, { type: 'invoke-delete' }> => ({
    type: 'invoke-delete',
    id: 9,
    paths,
    permanent,
  })

  it('builds the menu like a request would, runs the delete verb without showing it and releases', () => {
    const { menu, calls } = fakeMenu(0)
    const { native, routes } = fakeNative(menu)
    const { replies, post } = collect()
    runDeleteRequest(native, del(['D:\\Data\\a.txt', 'E:\\b.txt'], false), post)
    expect(routes).toEqual([
      {
        route: 'default',
        paths: ['D:\\Data\\a.txt', 'E:\\b.txt'],
        options: { extended: false, hideDestructive: false },
      },
    ])
    expect(menu.track).not.toHaveBeenCalled()
    expect(calls).toEqual(['delete', 'release'])
    expect(replies).toEqual([{ type: 'finished', id: 9, ok: true }])
  })

  it('passes permanent through', () => {
    const { menu } = fakeMenu(0)
    const { native } = fakeNative(menu)
    runDeleteRequest(native, del(['D:\\a.txt'], true), collect().post)
    expect(menu.invokeDelete).toHaveBeenCalledWith(true, false)
    runDeleteRequest(native, del(['D:\\a.txt'], false), collect().post, true)
    expect(menu.invokeDelete).toHaveBeenLastCalledWith(false, true)
  })

  it('reports a failing verb with its hresult and still releases', () => {
    const { menu } = fakeMenu(0)
    vi.mocked(menu.invokeDelete).mockImplementation(() => {
      throw new ShellMenuError('InvokeCommand', 0x800704c7)
    })
    const { native } = fakeNative(menu)
    const { replies, post } = collect()
    runDeleteRequest(native, del(['D:\\a.txt'], false), post)
    expect(menu.release).toHaveBeenCalledTimes(1)
    expect(replies).toEqual([
      { type: 'finished', id: 9, ok: false, hresult: 0x800704c7, step: 'InvokeCommand' },
    ])
  })

  it('reports a menu that cannot be built as failed', () => {
    const { menu } = fakeMenu(0)
    const { native } = fakeNative(menu)
    vi.mocked(native.build).mockImplementation(() => {
      throw new ShellMenuError('GetUIObjectOf', 0x80070002)
    })
    const { replies, post } = collect()
    runDeleteRequest(native, del(['D:\\a.txt'], false), post)
    expect(replies).toEqual([{ type: 'failed', id: 9, hresult: 0x80070002, step: 'GetUIObjectOf' }])
  })
})

describe('runEmptyBinRequest', () => {
  const request: Extract<WorkerRequest, { type: 'empty-bin' }> = {
    type: 'empty-bin',
    id: 4,
    root: 'D:\\',
  }

  it('calls the native empty-bin for the drive root and finishes', () => {
    const { menu } = fakeMenu(0)
    const { native } = fakeNative(menu)
    const { replies, post } = collect()
    runEmptyBinRequest(native, request, post)
    expect(native.emptyRecycleBin).toHaveBeenCalledWith('D:\\')
    expect(native.build).not.toHaveBeenCalled()
    expect(replies).toEqual([{ type: 'finished', id: 4, ok: true }])
  })

  it('reports a failing call with its hresult', () => {
    const { menu } = fakeMenu(0)
    const { native } = fakeNative(menu)
    vi.mocked(native.emptyRecycleBin).mockImplementation(() => {
      throw new ShellMenuError('SHEmptyRecycleBinW', 0x8000ffff)
    })
    const { replies, post } = collect()
    runEmptyBinRequest(native, request, post)
    expect(replies).toEqual([
      { type: 'finished', id: 4, ok: false, hresult: 0x8000ffff, step: 'SHEmptyRecycleBinW' },
    ])
  })
})

describe('runEmptyBinRequest: the root', () => {
  it.each(['', 'D:', 'D:\\Data', '\\\\server\\share\\'])(
    'refuses %j and never calls Windows (an empty root empties every bin)',
    (root) => {
      const { menu } = fakeMenu(0)
      const { native } = fakeNative(menu)
      const { replies, post } = collect()
      runEmptyBinRequest(native, { type: 'empty-bin', id: 5, root }, post)
      expect(native.emptyRecycleBin).not.toHaveBeenCalled()
      expect(replies).toEqual([
        { type: 'finished', id: 5, ok: false, hresult: 0x80070057, step: 'SHEmptyRecycleBinW' },
      ])
    },
  )
})
