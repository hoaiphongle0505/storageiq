import { describe, expect, it, vi } from 'vitest'
import { createWinRegistry, isAllowedTreeKey, type Advapi32 } from './win-registry'

function fakeNative() {
  const native: Advapi32 = {
    create: vi.fn(() => 1),
    open: vi.fn(() => 1),
    setValue: vi.fn(() => 0),
    queryValue: vi.fn(() => null),
    deleteValue: vi.fn(() => 0),
    deleteTree: vi.fn(() => 0),
    close: vi.fn(),
  }
  return native
}

describe('deleteTree scope', () => {
  it('refuses an empty key and unrelated keys before any native call', () => {
    const native = fakeNative()
    const registry = createWinRegistry(() => native)
    for (const key of [
      '',
      'Software',
      'Software\\Classes',
      'Software\\Classes\\Directory',
      'Software\\Classes\\Directory\\shell',
      'Software\\Classes\\Directory\\shell\\StorageIQ2',
      'Software\\StorageIQ-Test',
      'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
    ]) {
      expect(() => registry.deleteTree(key)).toThrow()
    }
    expect(native.deleteTree).not.toHaveBeenCalled()
  })

  it('accepts the three StorageIQ verb keys, their children and the test prefix', () => {
    const native = fakeNative()
    const registry = createWinRegistry(() => native)
    for (const key of [
      'Software\\Classes\\Directory\\shell\\StorageIQ',
      'software\\classes\\drive\\shell\\storageiq',
      'Software\\Classes\\Directory\\Background\\shell\\StorageIQ\\command',
      'Software\\StorageIQ-Test\\abc-123',
    ]) {
      registry.deleteTree(key)
    }
    expect(native.deleteTree).toHaveBeenCalledTimes(4)
  })

  it('isAllowedTreeKey needs a separator boundary', () => {
    expect(isAllowedTreeKey('Software\\Classes\\Drive\\shell\\StorageIQ-evil')).toBe(false)
    expect(isAllowedTreeKey('Software\\StorageIQ-Test\\')).toBe(false)
    expect(isAllowedTreeKey('Software\\StorageIQ-Test\\x')).toBe(true)
  })
})
