import { describe, expect, it } from 'vitest'
import {
  childrenArgs,
  contextMenuArgs,
  expandArgs,
  InvalidIpcArgumentsError,
  nodeArgs,
  noArgs,
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
  it('accepts a menu request', () => {
    expect(contextMenuArgs([SCAN, 'd4', 120, 300, false])).toEqual([SCAN, 'd4', 120, 300, false])
  })

  it.each([
    [[SCAN, 'd4', 120, 300]],
    [[SCAN, 'd4', -1, 300, false]],
    [[SCAN, 'd4', 120, 300, 'yes']],
    [[SCAN, 'd4', 1.5, 300, true]],
  ])('rejects %j', (args) => {
    expect(() => contextMenuArgs(args)).toThrow(InvalidIpcArgumentsError)
  })
})
