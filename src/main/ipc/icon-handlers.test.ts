import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { IconImage } from '@shared/ipc-contract'
import type { TreeNodeDetails } from '@shared/tree-types'
import type { NativeTarget } from '../icons/icon-keys'
import { createIconHandlers, type IconServiceLike } from './icon-handlers'
import { InvalidIpcArgumentsError } from './parse-args'
import { fakeTreeService, NODES, row, SCAN } from './test/fake-tree-service'

const event = {} as IpcMainInvokeEvent
const IMAGE: IconImage = { small: 'data:image/png;base64,AA', large: 'data:image/png;base64,BB' }

type Asked = Array<{ key: string; target: NativeTarget }>

function fakeIcons(options: { missing?: string[]; fails?: boolean; known?: string[] } = {}) {
  const calls: Asked[] = []
  const icons: IconServiceLike = {
    request: vi.fn(async (targets) => {
      calls.push([...targets])
      if (options.fails) throw new Error('worker exploded')
      const images: Record<string, IconImage> = {}
      const missing: string[] = []
      for (const { key } of targets) {
        if (options.missing?.includes(key)) missing.push(key)
        else images[key] = IMAGE
      }
      return { images, missing }
    }),
    knownFolders: vi.fn(async () => new Set(options.known ?? [])),
    newScan: vi.fn(),
  }
  return { icons, calls }
}

/** Extra nodes: an .exe, a .lnk, a drive root, a known folder, a file without extension. */
function node(id: string, path: string, kind: 'file' | 'folder', name: string): TreeNodeDetails {
  return {
    row: row({ id, kind, name, parentId: 'g1', childCount: 0 }),
    path,
    ancestorIds: ['d0'],
    locations: [],
  }
}
const EXTRA: Record<string, TreeNodeDetails> = {
  f20: node('f20', 'D:\\Data\\Tools\\Setup.EXE', 'file', 'Setup.EXE'),
  f21: node('f21', 'D:\\Data\\Tools\\a.lnk', 'file', 'a.lnk'),
  f22: node('f22', 'D:\\Data\\LICENSE', 'file', 'LICENSE'),
  d30: node('d30', 'D:\\Data\\Downloads', 'folder', 'Downloads'),
  r0: {
    row: row({ id: 'd0', parentId: null, name: 'E:\\', kind: 'folder' }),
    path: 'E:\\',
    ancestorIds: [],
    locations: [],
  },
}

function setup(
  tree: Parameters<typeof fakeTreeService>[0] = {},
  iconOptions: Parameters<typeof fakeIcons>[0] = {},
) {
  const fake = fakeTreeService({ extra: EXTRA, ...tree })
  const icons = fakeIcons(iconOptions)
  const handlers = createIconHandlers({ scanService: fake.service, icons: icons.icons })
  const forNodes = (ids: string[], scanId = SCAN) =>
    Promise.resolve(handlers['icons:for-nodes'].handle(event, scanId, ids))
  return { ...fake, ...icons, handlers, forNodes }
}

describe('icons:for-nodes', () => {
  it('resolves every id through the scan and passes only scanner paths to the service', async () => {
    const { forNodes, calls, queries } = setup()
    await forNodes(['f7', 'f9', 'f20'])
    expect(
      queries.filter((q) => q.kind === 'node').map((q) => (q as { nodeId: string }).nodeId),
    ).toEqual(expect.arrayContaining(['f7', 'f9', 'f20']))
    const targets = calls[0]!
    const paths = targets.flatMap((t) => (t.target.kind === 'path' ? [t.target.path] : []))
    expect(paths).toEqual(['D:\\Data\\Tools\\Setup.EXE'])
    expect(targets.map((t) => t.key).filter((k) => !k.startsWith('f:'))).toEqual([
      'ext:jpg',
      'ext:txt',
    ])
  })

  it('dedupes ids', async () => {
    const { forNodes, queries } = setup()
    const batch = await forNodes(['f7', 'f7', 'f7'])
    expect(queries.filter((q) => q.kind === 'node')).toHaveLength(1)
    expect(Object.keys(batch.keys)).toEqual(['f7'])
  })

  it('drops ids that no longer resolve', async () => {
    const { forNodes } = setup()
    const batch = await forNodes(['f7', 'f999'])
    expect(Object.keys(batch.keys)).toEqual(['f7'])
    expect(batch.pending).toEqual([])
  })

  it('answers empty for a scan id that is not current', async () => {
    const { forNodes, calls } = setup()
    await expect(forNodes(['f7'], '11111111-1111-1111-1111-111111111111')).resolves.toEqual({
      keys: {},
      images: {},
      pending: [],
    })
    expect(calls).toHaveLength(0)
  })

  it('classifies a drive root, a folder, a file and a per-file extension', async () => {
    const { forNodes, calls } = setup({}, { known: [] })
    const batch = await forNodes(['f7', 'd1', 'd0', 'f20', 'f21', 'f22'])
    expect(batch.keys['f7']).toBe('ext:jpg')
    expect(batch.keys['d1']).toBe('dir')
    expect(batch.keys['f22']).toBe('file')
    expect(batch.keys['f20']).toMatch(/^f:[0-9a-f]{12}$/)
    expect(batch.keys['f21']).toMatch(/^f:[0-9a-f]{12}$/)
    expect(batch.keys['f20']).not.toBe(batch.keys['f21'])
    // d0 of the fake scan is `D:\Data`, not a drive: any other root is a plain folder.
    expect(batch.keys['d0']).toBe('dir')
    const targets = new Map(calls[0]!.map((t) => [t.key, t.target]))
    expect(targets.get('dir')).toEqual({ kind: 'dir' })
    expect(targets.get('file')).toEqual({ kind: 'file', ext: '' })
    expect(targets.get(batch.keys['f20']!)).toEqual({
      kind: 'path',
      path: 'D:\\Data\\Tools\\Setup.EXE',
    })
    expect(Object.keys(batch.images).sort()).toEqual(
      Object.values(batch.keys)
        .sort()
        .filter((k, i, all) => all.indexOf(k) === i),
    )
  })

  it('a drive root is asked for by its drive letter', async () => {
    const { forNodes, calls } = setup({ extra: { ...EXTRA, d0: EXTRA['r0']! } })
    const batch = await forNodes(['d0'])
    expect(batch.keys['d0']).toBe('drive:e')
    expect(calls[0]).toEqual([{ key: 'drive:e', target: { kind: 'path', path: 'E:\\' } }])
  })

  it('a known folder gets a per-path key and a real lookup, other folders keep dir', async () => {
    const { forNodes, calls } = setup({}, { known: ['d:\\data\\downloads'] })
    const batch = await forNodes(['d30', 'd1'])
    expect(batch.keys['d30']).toMatch(/^f:[0-9a-f]{12}$/)
    expect(batch.keys['d1']).toBe('dir')
    const targets = new Map(calls[0]!.map((t) => [t.key, t.target]))
    expect(targets.get(batch.keys['d30']!)).toEqual({ kind: 'path', path: 'D:\\Data\\Downloads' })
  })

  it('files group rows are dropped', async () => {
    const { forNodes, calls } = setup()
    const batch = await forNodes(['g1', 'f7'])
    expect(Object.keys(batch.keys)).toEqual(['f7'])
    expect(calls[0]!.some((t) => t.target.kind === 'path')).toBe(false)
  })

  it('a per-file row the worker could not answer gets its type icon and is pending', async () => {
    const first = setup()
    const key = (await first.forNodes(['f20'])).keys['f20']!
    const { forNodes, calls } = setup({}, { missing: [key] })
    const batch = await forNodes(['f20', 'f7'])
    expect(batch.pending).toEqual(['f20'])
    expect(batch.keys['f20']).toBe('ext:exe')
    expect(batch.images['ext:exe']).toEqual(IMAGE)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual([{ key: 'ext:exe', target: { kind: 'file', ext: 'exe' } }])
  })

  it('an icons call never rejects when the service fails', async () => {
    const { forNodes, handlers } = setup({}, { fails: true })
    const batch = await forNodes(['f7', 'f20'])
    expect(batch.images).toEqual({})
    expect(Object.keys(batch.keys).sort()).toEqual(['f20', 'f7'])
    await expect(
      Promise.resolve(handlers['icons:for-types'].handle(event, ['ext:txt'])),
    ).resolves.toEqual({})
  })

  it('tells the service when a different scan is asked about', async () => {
    const { forNodes, icons } = setup()
    await forNodes(['f7'])
    await forNodes(['f9'])
    expect(icons.newScan).toHaveBeenCalledTimes(1)
  })

  it('validates its arguments', () => {
    const { handlers } = setup()
    expect(() => handlers['icons:for-nodes'].parseArgs([SCAN, []])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(handlers['icons:for-nodes'].parseArgs([SCAN, ['f1']])).toEqual([SCAN, ['f1']])
  })
})

describe('icons:for-types', () => {
  it('icons:for-types maps keys to targets and never receives a path', async () => {
    const { handlers, calls } = setup()
    const images = await Promise.resolve(
      handlers['icons:for-types'].handle(event, ['ext:txt', 'dir', 'file', 'drive']),
    )
    expect(Object.keys(images).sort()).toEqual(['dir', 'drive', 'ext:txt', 'file'])
    const targets = new Map(calls[0]!.map((t) => [t.key, t.target]))
    expect(targets.get('ext:txt')).toEqual({ kind: 'file', ext: 'txt' })
    expect(targets.get('dir')).toEqual({ kind: 'dir' })
    expect(targets.get('file')).toEqual({ kind: 'file', ext: '' })
    expect(targets.get('drive')).toEqual({
      kind: 'path',
      path: `${process.env['SystemDrive'] ?? 'C:'}\\`,
    })
    for (const bad of [['C:\\Windows'], ['ext:.exe'], ['f:0123456789ab'], []]) {
      expect(() => handlers['icons:for-types'].parseArgs([bad])).toThrow(InvalidIpcArgumentsError)
    }
  })
})

describe('the fake tree', () => {
  it('still has the nodes this file relies on', () => {
    expect(NODES['f7']?.path).toBe('D:\\Data\\Photos\\a.jpg')
    expect(NODES['f9']?.path).toBe('D:\\Data\\Docs\\b.txt')
  })
})
