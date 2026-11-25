import { describe, expect, it } from 'vitest'
import { isShellPathGone, SHELL_PATH_GONE_HRESULTS, ShellMenuError } from './win-shell-menu'

describe('ShellMenuError', () => {
  it('carries the HRESULT as an unsigned number and the step in its message', () => {
    const error = new ShellMenuError('SHParseDisplayName', 0x80070002 | 0)
    expect(error.hresult).toBe(0x80070002)
    expect(error.step).toBe('SHParseDisplayName')
    expect(error.name).toBe('ShellMenuError')
    expect(error.message).toBe('SHParseDisplayName failed (0x80070002)')
    expect(error).toBeInstanceOf(Error)
  })

  it('knows the two path-gone codes', () => {
    expect(SHELL_PATH_GONE_HRESULTS).toEqual([0x80070002, 0x80070003])
    expect(isShellPathGone(new ShellMenuError('SHParseDisplayName', 0x80070002))).toBe(true)
    expect(isShellPathGone(new ShellMenuError('SHParseDisplayName', 0x80070003))).toBe(true)
    expect(isShellPathGone(new ShellMenuError('GetUIObjectOf', 0x80004005))).toBe(false)
    expect(isShellPathGone(new Error('SHParseDisplayName failed (0x80070002)'))).toBe(false)
    expect(isShellPathGone(undefined)).toBe(false)
  })
})
