import { describe, expect, it } from 'vitest'
import { guid } from './win-shell-menu'

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
