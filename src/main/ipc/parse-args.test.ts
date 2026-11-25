import { describe, expect, it } from 'vitest'
import {
  aboutLinkArg,
  childrenArgs,
  contextMenuArgs,
  expandArgs,
  iconNodesArgs,
  iconTypesArgs,
  InvalidIpcArgumentsError,
  MAX_ACTION_ITEMS,
  MAX_ICON_ITEMS,
  nodeArgs,
  nodeIdListArg,
  noArgs,
  oneBoolean,
  oneString,
  scanNodeArgs,
  treemapArgs,
} from './parse-args'

const SCAN = '0d6b2f6e-8a3c-4c1e-9f61-2b8f6a1d5e10'

describe('noArgs', () => {
  it('accepts an empty argument list', () => {
    expect(noArgs([])).toEqual([])
  })

  it('rejects any argument', () => {
    expect(() => noArgs(['surprise'])).toThrow(InvalidIpcArgumentsError)
  })
})

describe('oneString', () => {
  it('accepts exactly one string', () => {
    expect(oneString(['C:\\Data'])).toEqual(['C:\\Data'])
  })

  it.each([[[]], [['a', 'b']]])('rejects %j (wrong number of arguments)', (args) => {
    expect(() => oneString(args)).toThrow(InvalidIpcArgumentsError)
  })

  it.each([[[42]], [[null]]])('rejects %j (not a string)', (args) => {
    expect(() => oneString(args)).toThrow('Invalid IPC arguments: expected a string')
  })
})

describe('scanNodeArgs', () => {
  it('accepts a scan id and a node id', () => {
    expect(scanNodeArgs([SCAN, 'd12'])).toEqual([SCAN, 'd12'])
    expect(scanNodeArgs([SCAN, 'g0'])).toEqual([SCAN, 'g0'])
    expect(scanNodeArgs([SCAN, 'f999'])).toEqual([SCAN, 'f999'])
  })

  it.each([
    [[SCAN]],
    [[SCAN, 'd1', 'extra']],
    [['not a scan id!', 'd1']],
    [[SCAN, 'C:\\Windows']],
    [[SCAN, 'x1']],
    [[SCAN, 'd']],
    [[SCAN, 'd1234567890']],
    [[SCAN, 7]],
  ])('rejects %j', (args) => {
    expect(() => scanNodeArgs(args)).toThrow(InvalidIpcArgumentsError)
  })
})

describe('childrenArgs', () => {
  it('accepts a full page request', () => {
    expect(childrenArgs([SCAN, 'd0', 'size', 'desc', 0, 200])).toEqual([
      SCAN,
      'd0',
      'size',
      'desc',
      0,
      200,
    ])
  })

  it.each([
    [[SCAN, 'd0', 'colour', 'desc', 0, 10]],
    [[SCAN, 'd0', 'size', 'down', 0, 10]],
    [[SCAN, 'd0', 'size', 'desc', -1, 10]],
    [[SCAN, 'd0', 'size', 'desc', 0, 0]],
    [[SCAN, 'd0', 'size', 'desc', 0, 1001]],
    [[SCAN, 'd0', 'size', 'desc', 0.5, 10]],
    [[SCAN, 'd0', 'size', 'desc', 0]],
  ])('rejects %j', (args) => {
    expect(() => childrenArgs(args)).toThrow(InvalidIpcArgumentsError)
  })
})

describe('nodeArgs and expandArgs', () => {
  it('accept valid arguments', () => {
    expect(nodeArgs([SCAN, 'f3', 'name', 'asc'])).toEqual([SCAN, 'f3', 'name', 'asc'])
    expect(expandArgs([SCAN, 'd0', 5])).toEqual([SCAN, 'd0', 5])
  })

  it('reject invalid arguments', () => {
    expect(() => nodeArgs([SCAN, 'f3', 'name'])).toThrow(InvalidIpcArgumentsError)
    expect(() => expandArgs([SCAN, 'd0', 0])).toThrow(InvalidIpcArgumentsError)
    expect(() => expandArgs([SCAN, 'd0', 65])).toThrow(InvalidIpcArgumentsError)
  })
})

describe('treemapArgs', () => {
  it('accepts a layout request', () => {
    expect(treemapArgs([SCAN, 'd0', 'allocated', 5, 800, 240])).toEqual([
      SCAN,
      'd0',
      'allocated',
      5,
      800,
      240,
    ])
  })

  it.each([
    [[SCAN, 'd0', 'colour', 0, 800, 240]],
    [[SCAN, 'd0', 'size', 6, 800, 240]],
    [[SCAN, 'd0', 'size', 0, 0, 240]],
    [[SCAN, 'd0', 'size', 0, 800, 10_001]],
  ])('rejects %j', (args) => {
    expect(() => treemapArgs(args)).toThrow(InvalidIpcArgumentsError)
  })
})

describe('contextMenuArgs', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i + 1}`)

  it('contextMenuArgs accepts 1 id and 1000 ids', () => {
    expect(contextMenuArgs([SCAN, ['d4'], 120, 300, false])).toEqual([
      SCAN,
      ['d4'],
      120,
      300,
      false,
    ])
    expect(contextMenuArgs([SCAN, ids(1000), 1, 2, true])[1]).toHaveLength(1000)
    expect(MAX_ACTION_ITEMS).toBe(1000)
  })

  it('contextMenuArgs rejects an empty list', () => {
    expect(() => contextMenuArgs([SCAN, [], 1, 2, false])).toThrow(
      'expected 1 to 1000 tree node ids',
    )
  })

  it('contextMenuArgs rejects 1001 ids', () => {
    expect(() => contextMenuArgs([SCAN, ids(1001), 1, 2, false])).toThrow(InvalidIpcArgumentsError)
  })

  it('a request of 1001 items never reaches the handler', () => {
    expect(() => nodeIdListArg(ids(1001), MAX_ACTION_ITEMS)).toThrow(InvalidIpcArgumentsError)
    expect(nodeIdListArg(ids(3), 3)).toEqual(['f1', 'f2', 'f3'])
  })

  it('contextMenuArgs rejects a non-array, a non-string id and an id with a bad pattern', () => {
    expect(() => contextMenuArgs([SCAN, new Set(['d1']), 1, 2, false])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => contextMenuArgs([SCAN, [4], 1, 2, false])).toThrow(InvalidIpcArgumentsError)
    expect(() => contextMenuArgs([SCAN, ['d1', 'C:\\Windows'], 1, 2, false])).toThrow(
      InvalidIpcArgumentsError,
    )
  })

  it('contextMenuArgs rejects a sparse array', () => {
    const sparse = Object.assign(new Array<string>(3), { 0: 'd1' })
    expect(() => contextMenuArgs([SCAN, sparse, 1, 2, false])).toThrow(InvalidIpcArgumentsError)
  })

  it('contextMenuArgs rejects the old single-id form', () => {
    expect(() => contextMenuArgs([SCAN, 'd4', 120, 300, false])).toThrow(InvalidIpcArgumentsError)
  })

  it('contextMenuArgs still validates x, y and extended', () => {
    for (const args of [
      [SCAN, ['d4'], 120, 300],
      [SCAN, ['d4'], -1, 300, false],
      [SCAN, ['d4'], 120, 300, 'yes'],
      [SCAN, ['d4'], 1.5, 300, true],
    ]) {
      expect(() => contextMenuArgs(args)).toThrow(InvalidIpcArgumentsError)
    }
  })
})

describe('icon arguments', () => {
  const ids = (count: number) => Array.from({ length: count }, (_, i) => `f${i + 1}`)

  it('iconNodesArgs accepts 1 id and 64 ids', () => {
    expect(MAX_ICON_ITEMS).toBe(64)
    expect(iconNodesArgs([SCAN, ['f1']])).toEqual([SCAN, ['f1']])
    expect(iconNodesArgs([SCAN, ids(64)])[1]).toHaveLength(64)
  })

  it('iconNodesArgs rejects an empty list, 65 ids, a non-array, a non-string id and a bad pattern', () => {
    for (const list of [[], ids(65), 'f1', [7], ['../x'], ['x1']]) {
      expect(() => iconNodesArgs([SCAN, list])).toThrow(InvalidIpcArgumentsError)
    }
    expect(() => iconNodesArgs([SCAN, []])).toThrow('expected 1 to 64 tree node ids')
  })

  it('iconNodesArgs rejects a missing or malformed scan id', () => {
    expect(() => iconNodesArgs([['f1']])).toThrow(InvalidIpcArgumentsError)
    expect(() => iconNodesArgs(['not a scan id!', ['f1']])).toThrow(InvalidIpcArgumentsError)
    expect(() => iconNodesArgs([42, ['f1']])).toThrow(InvalidIpcArgumentsError)
  })

  it('iconTypesArgs accepts dir, drive, file and ext keys', () => {
    const keys = ['dir', 'drive', 'file', 'ext:txt', 'ext:7z', 'ext:a_b$~-']
    expect(iconTypesArgs([keys])).toEqual([keys])
  })

  it('iconTypesArgs rejects a path, a drive letter, a dotted extension, a separator and an uppercase key', () => {
    for (const key of [
      'C:\\Windows',
      'C:\\',
      'drive:C',
      'ext:.txt',
      'ext:a.b',
      'ext:a/b',
      'ext:a\\b',
      'ext:TXT',
      'DIR',
      'f:0123456789ab',
      'ext:',
      'ext:12345678901234567',
      7,
    ]) {
      expect(() => iconTypesArgs([[key]])).toThrow(InvalidIpcArgumentsError)
    }
  })

  it('iconTypesArgs rejects 65 keys and an empty list', () => {
    expect(() => iconTypesArgs([Array.from({ length: 65 }, () => 'dir')])).toThrow(
      InvalidIpcArgumentsError,
    )
    expect(() => iconTypesArgs([[]])).toThrow(InvalidIpcArgumentsError)
    expect(() => iconTypesArgs(['dir'])).toThrow(InvalidIpcArgumentsError)
  })
})

describe('aboutLinkArg', () => {
  it('accepts only the five fixed keys as the single argument', () => {
    for (const key of ['repo', 'license', 'releases', 'help', 'issues']) {
      expect(aboutLinkArg([key])).toEqual([key])
    }
    for (const bad of [[], ['x'], ['https://a.example'], ['repo', 'repo'], [1]]) {
      expect(() => aboutLinkArg(bad)).toThrow(InvalidIpcArgumentsError)
    }
  })
})

describe('oneBoolean', () => {
  it('oneBoolean accepts true and false', () => {
    expect(oneBoolean([true])).toEqual([true])
    expect(oneBoolean([false])).toEqual([false])
  })

  it("oneBoolean rejects 1, 'true', null, undefined, objects", () => {
    for (const bad of [1, 0, 'true', 'false', null, undefined, {}, [true]]) {
      expect(() => oneBoolean([bad])).toThrow(InvalidIpcArgumentsError)
    }
  })

  it('oneBoolean rejects zero or two arguments', () => {
    expect(() => oneBoolean([])).toThrow(InvalidIpcArgumentsError)
    expect(() => oneBoolean([true, false])).toThrow(InvalidIpcArgumentsError)
  })
})
