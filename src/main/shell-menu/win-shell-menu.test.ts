import { describe, expect, it } from 'vitest'
import { deleteInvokeInfo, deleteInvokeMask, guid, invokeMask } from './win-shell-menu'

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

describe('deleteInvokeMask', () => {
  it('sets SHIFT_DOWN only for a permanent delete, and never PTINVOKE', () => {
    expect(deleteInvokeMask(true, true) & 0x400).toBe(0x400)
    expect(deleteInvokeMask(true) & 0x400).toBe(0)
    expect(deleteInvokeMask(true) & 0x10000000).toBe(0x10000000)
    expect(deleteInvokeMask(false) & 0x10000000).toBe(0)
    for (const permanent of [true, false]) {
      expect(deleteInvokeMask(permanent) & 0x20000000).toBe(0)
      expect(deleteInvokeMask(permanent) & 0x100).toBe(0x100)
      expect(deleteInvokeMask(permanent) & 0x4000).toBe(0x4000)
      expect(deleteInvokeMask(permanent) & 0x40000000).toBe(0)
    }
  })
})

describe('deleteInvokeInfo', () => {
  it('passes the verb as pointers to "delete" (ANSI and wide), not as an offset', () => {
    const owner = { hwnd: 1 }
    const info = deleteInvokeInfo(owner, false, 106)
    expect(Buffer.isBuffer(info.lpVerb)).toBe(true)
    expect(Buffer.isBuffer(info.lpVerbW)).toBe(true)
    expect((info.lpVerb as Buffer).toString('latin1')).toBe('delete\0')
    expect((info.lpVerbW as Buffer).toString('utf16le')).toBe('delete\0')
    expect(info.hwnd).toBe(owner)
    expect(info.cbSize).toBe(106)
    expect(info.fMask).toBe(deleteInvokeMask(false))
  })
})
