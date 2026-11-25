import { describe, expect, it } from 'vitest'
import { addRunAsAdmin, removeRunAsAdmin } from './layers-flags'

describe('addRunAsAdmin', () => {
  it('adds RUNASADMIN to a missing value', () => {
    expect(addRunAsAdmin(null)).toBe('~ RUNASADMIN')
    expect(addRunAsAdmin('')).toBe('~ RUNASADMIN')
  })

  it('adds RUNASADMIN after other flags and keeps them', () => {
    expect(addRunAsAdmin('~ WIN7RTM')).toBe('~ WIN7RTM RUNASADMIN')
  })

  it('is idempotent when the flag is already set', () => {
    expect(addRunAsAdmin('~ RUNASADMIN')).toBe('~ RUNASADMIN')
    expect(addRunAsAdmin('~ RUNASADMIN WIN7RTM')).toBe('~ RUNASADMIN WIN7RTM')
  })

  it('matches the flag case-insensitively', () => {
    expect(addRunAsAdmin('~ runasadmin')).toBe('~ runasadmin')
    expect(removeRunAsAdmin('~ WIN7RTM runAsAdmin')).toBe('~ WIN7RTM')
  })

  it('keeps a value without a leading tilde and appends the flag', () => {
    expect(addRunAsAdmin('WIN7RTM')).toBe('WIN7RTM RUNASADMIN')
  })
})

describe('removeRunAsAdmin', () => {
  it('removes only RUNASADMIN and keeps other flags', () => {
    expect(removeRunAsAdmin('~ WIN7RTM RUNASADMIN')).toBe('~ WIN7RTM')
    expect(removeRunAsAdmin('~ RUNASADMIN WIN7RTM')).toBe('~ WIN7RTM')
  })

  it('returns null when RUNASADMIN was the only flag', () => {
    expect(removeRunAsAdmin('~ RUNASADMIN')).toBeNull()
    expect(removeRunAsAdmin('RUNASADMIN')).toBeNull()
    expect(removeRunAsAdmin('~')).toBeNull()
  })

  it('returns null for null or empty input', () => {
    expect(removeRunAsAdmin(null)).toBeNull()
    expect(removeRunAsAdmin('')).toBeNull()
    expect(removeRunAsAdmin('   ')).toBeNull()
  })

  it('collapses repeated whitespace only when it changes the value', () => {
    expect(addRunAsAdmin('~   WIN7RTM    RUNASADMIN')).toBe('~   WIN7RTM    RUNASADMIN')
    expect(addRunAsAdmin('~   WIN7RTM')).toBe('~ WIN7RTM RUNASADMIN')
    expect(removeRunAsAdmin('~   WIN7RTM   RUNASADMIN')).toBe('~ WIN7RTM')
  })
})
