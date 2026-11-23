import { describe, expect, it } from 'vitest'
import { guid, invokeMask } from './win-shell-menu'

describe('guid', () => {
  it('splits an IID into little-endian fields and the 8 trailing bytes', () => {
    expect(guid('{BCFCE0A0-EC17-11D0-8D10-00A0C90F2719}')).toEqual({
      d1: 0xbcfce0a0,
      d2: 0xec17,
      d3: 0x11d0,
      d4: [0x8d, 0x10, 0x00, 0xa0, 0xc9, 0x0f, 0x27, 0x19],
    })
  })
})

describe('invokeMask', () => {
  it('always asks for NOASYNC (the worker thread has no message loop) and adds the live keys', () => {
    expect(invokeMask(false, false) & 0x100).toBe(0x100)
    expect(invokeMask(true, false) & 0x10000000).toBe(0x10000000)
    expect(invokeMask(false, true) & 0x40000000).toBe(0x40000000)
    expect(invokeMask(false, false) & 0x10000000).toBe(0)
  })
})
