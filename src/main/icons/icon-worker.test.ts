import { describe, expect, it, vi } from 'vitest'
import type { NativeTarget } from './icon-keys'
import type { IconWorkerReply } from './icon-worker-protocol'
import { runGetRequest, runKnownFoldersRequest, type IconNative } from './icon-worker'
import { bitmapFromIcon, type IconGdi } from './win-icons'
import type { RgbaBitmap } from './png'

const bitmap = (size: number): RgbaBitmap => ({
  width: size,
  height: size,
  data: new Uint8Array(size * size * 4).fill(255),
})

function fakeNative(overrides: Partial<IconNative> = {}): IconNative & {
  fetched: NativeTarget[]
} {
  const fetched: NativeTarget[] = []
  return {
    fetched,
    attributes: () => 0x20,
    fetch: (target) => {
      fetched.push(target)
      return { small: bitmap(16), large: bitmap(32) }
    },
    knownFolders: () => [],
    dispose: () => undefined,
    ...overrides,
  }
}

function run(
  native: IconNative,
  items: Array<{ key: string; target: NativeTarget }>,
  clock: () => number = () => 0,
  budgetMs = 2500,
): IconWorkerReply[] {
  const replies: IconWorkerReply[] = []
  runGetRequest(native, { type: 'get', id: 7, items }, (reply) => replies.push(reply), {
    now: clock,
    budgetMs,
  })
  return replies
}

const ext = (name: string): NativeTarget => ({ kind: 'file', ext: name })

describe('the icon worker', () => {
  it('answers in input order', () => {
    const native = fakeNative()
    const [reply] = run(native, [
      { key: 'ext:b', target: ext('b') },
      { key: 'dir', target: { kind: 'dir' } },
      { key: 'ext:a', target: ext('a') },
    ])
    expect(reply).toMatchObject({ type: 'icons', id: 7 })
    if (reply?.type !== 'icons') throw new Error('expected icons')
    expect(reply.results.map((result) => result.key)).toEqual(['ext:b', 'dir', 'ext:a'])
    expect(native.fetched).toEqual([ext('b'), { kind: 'dir' }, ext('a')])
    const first = reply.results[0]
    expect(first?.size).toEqual({ small: 16, large: 32 })
    expect(first?.image?.small).toMatch(/^data:image\/png;base64,/)
    expect(first?.image?.large).toMatch(/^data:image\/png;base64,/)
  })

  it('stops at the budget and marks the rest null', () => {
    let clock = 0
    const native = fakeNative({
      fetch: (target) => {
        clock += 1000
        native.fetched.push(target)
        return { small: bitmap(16), large: bitmap(32) }
      },
    })
    const [reply] = run(
      native,
      ['a', 'b', 'c', 'd', 'e'].map((name) => ({ key: `ext:${name}`, target: ext(name) })),
      () => clock,
      2500,
    )
    if (reply?.type !== 'icons') throw new Error('expected icons')
    expect(reply.results.map((result) => result.image !== null)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ])
    expect(reply.results[3]).toMatchObject({ key: 'ext:d', image: null, size: null, skipped: true })
    expect(native.fetched).toHaveLength(3)
  })

  it('a per-file target whose attributes say cloud placeholder falls back to the by-extension lookup', () => {
    const path = (name: string): NativeTarget => ({ kind: 'path', path: `C:\\OneDrive\\${name}` })
    for (const attributes of [0x00400000, 0x00040000, 0x1000, null]) {
      const native = fakeNative({ attributes: () => attributes })
      run(native, [{ key: 'f:0123456789ab', target: path('tool.EXE') }])
      expect(native.fetched).toEqual([{ kind: 'file', ext: 'exe' }])
    }
    const local = fakeNative({ attributes: () => 0x20 })
    run(local, [{ key: 'f:0123456789ab', target: path('tool.exe') }])
    expect(local.fetched).toEqual([path('tool.exe')])
  })

  it('a path target of a folder is looked up as is unless it is offline', () => {
    const folder: NativeTarget = { kind: 'path', path: 'C:\\Users\\Ana\\Downloads' }
    const native = fakeNative({ attributes: () => 0x10 })
    run(native, [{ key: 'f:0123456789ab', target: folder }])
    expect(native.fetched).toEqual([folder])
    const offline = fakeNative({ attributes: () => 0x10 | 0x1000 })
    run(offline, [{ key: 'f:0123456789ab', target: folder }])
    expect(offline.fetched).toEqual([{ kind: 'dir' }])
  })

  it('answers null for an item whose lookup throws and keeps going', () => {
    let calls = 0
    const native = fakeNative({
      fetch: () => {
        calls += 1
        if (calls === 1) throw new Error('shell extension crashed')
        return { small: bitmap(16), large: bitmap(32) }
      },
    })
    const [reply] = run(native, [
      { key: 'ext:a', target: ext('a') },
      { key: 'ext:b', target: ext('b') },
    ])
    if (reply?.type !== 'icons') throw new Error('expected icons')
    expect(reply.results[0]).toMatchObject({ key: 'ext:a', image: null })
    expect(reply.results[1]?.image).not.toBeNull()
  })

  it('reports the known folders', () => {
    const replies: IconWorkerReply[] = []
    runKnownFoldersRequest(
      fakeNative({ knownFolders: () => ['C:\\Users\\Ana'] }),
      { type: 'known-folders', id: 3 },
      (reply) => replies.push(reply),
    )
    expect(replies).toEqual([{ type: 'known-folders', id: 3, paths: ['C:\\Users\\Ana'] }])
  })
})

/** A GDI that records every handle it hands out and every release. */
function fakeGdi(overrides: Partial<IconGdi> = {}) {
  const released: string[] = []
  const gdi: IconGdi = {
    iconInfo: () => ({ hbmColor: 'color', hbmMask: 'mask' }),
    bitmapSize: () => ({ width: 2, height: 1 }),
    createDc: () => 'dc',
    dibits: (_dc, handle) =>
      // BGRA bytes, top-down. The colour bitmap carries alpha; the mask is not asked for.
      handle === 'color'
        ? Uint8Array.from([1, 2, 3, 255, 10, 20, 30, 128])
        : Uint8Array.from([0, 0, 0, 0, 255, 255, 255, 0]),
    deleteObject: (handle) => released.push(`object:${String(handle)}`),
    deleteDc: (dc) => released.push(`dc:${String(dc)}`),
    destroyIcon: (icon) => released.push(`icon:${String(icon)}`),
    ...overrides,
  }
  return { gdi, released }
}

describe('bitmapFromIcon', () => {
  it('swaps B and R and keeps the alpha of a 32-bit icon', () => {
    const { gdi, released } = fakeGdi()
    expect(bitmapFromIcon(gdi, 'icon')).toEqual({
      width: 2,
      height: 1,
      data: Uint8Array.from([3, 2, 1, 255, 30, 20, 10, 128]),
    })
    expect(released.sort()).toEqual(['dc:dc', 'icon:icon', 'object:color', 'object:mask'])
  })

  it('derives alpha from the mask when every alpha byte of the colour bitmap is 0', () => {
    const { gdi } = fakeGdi({
      dibits: (_dc, handle) =>
        handle === 'color'
          ? Uint8Array.from([1, 2, 3, 0, 10, 20, 30, 0])
          : // mask: black is opaque, white is transparent
            Uint8Array.from([0, 0, 0, 0, 255, 255, 255, 0]),
    })
    expect(bitmapFromIcon(gdi, 'icon')?.data).toEqual(
      Uint8Array.from([3, 2, 1, 255, 30, 20, 10, 0]),
    )
  })

  it('answers null for a monochrome icon and still releases the handles', () => {
    const { gdi, released } = fakeGdi({ iconInfo: () => ({ hbmColor: null, hbmMask: 'mask' }) })
    expect(bitmapFromIcon(gdi, 'icon')).toBeNull()
    expect(released.sort()).toEqual(['icon:icon', 'object:mask'])
  })

  it('releases every handle when a later step throws', () => {
    for (const failing of ['bitmapSize', 'createDc', 'dibits'] as const) {
      const { gdi, released } = fakeGdi({
        [failing]: vi.fn(() => {
          throw new Error(`${failing} failed`)
        }),
      })
      expect(() => bitmapFromIcon(gdi, 'icon')).toThrow(`${failing} failed`)
      const expected = ['icon:icon', 'object:color', 'object:mask']
      if (failing === 'dibits') expected.push('dc:dc')
      expect(released.sort()).toEqual(expected.sort())
    }
  })
})
