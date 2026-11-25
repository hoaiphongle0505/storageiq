import { describe, expect, it } from 'vitest'
import { compareVersions, parseVersion } from './semver'

describe('semver', () => {
  it('parseVersion accepts release, prerelease and build versions', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] })
    expect(parseVersion('0.2.0-beta.1')?.prerelease).toEqual(['beta', '1'])
    expect(parseVersion('1.0.0+build.5')).not.toBeNull()
    expect(parseVersion('1.0.0-rc.1+sha.abc')).not.toBeNull()
  })

  it('parseVersion rejects leading v, leading zeros, extra parts and long input', () => {
    for (const bad of ['v1.2.3', '01.2.3', '1.02.3', '1.2', '1.2.3.4', '1.2.3-', '1.2.3-01', '']) {
      expect(parseVersion(bad), bad).toBeNull()
    }
    expect(parseVersion('1234567890.0.0')).toBeNull()
    expect(parseVersion(`1.0.0-${'a'.repeat(70)}`)).toBeNull()
  })

  it('compareVersions orders prerelease below release', () => {
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0', '0.2.0-beta.1')).toBe(1)
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
  })

  it('compareVersions compares numeric prerelease identifiers numerically', () => {
    expect(compareVersions('0.2.0-beta.2', '0.2.0-beta.10')).toBe(-1)
    expect(compareVersions('0.2.0-beta.10', '0.2.0')).toBe(-1)
    expect(compareVersions('0.2.0-1', '0.2.0-alpha')).toBe(-1)
    expect(compareVersions('0.2.0-beta', '0.2.0-beta.1')).toBe(-1)
    expect(compareVersions('0.2.0-alpha', '0.2.0-beta')).toBe(-1)
  })

  it('compareVersions ignores build metadata', () => {
    expect(compareVersions('1.0.0+a', '1.0.0+b')).toBe(0)
  })

  it('compareVersions returns null for an invalid version', () => {
    expect(compareVersions('x', '1.0.0')).toBeNull()
    expect(compareVersions('1.0.0', 'v1.0.0')).toBeNull()
  })
})
