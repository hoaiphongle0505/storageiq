import { describe, expect, it } from 'vitest'
import { InvalidIpcArgumentsError, noArgs, oneString } from './parse-args'

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
