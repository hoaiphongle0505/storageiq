import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { createWinRegistry } from './win-registry'

const ROOT = `Software\\StorageIQ-Test\\${randomUUID()}`
const PREFIX = 'Software\\StorageIQ-Test\\'

/** Every write goes through this guard: nothing outside the throwaway key is ever touched. */
function guarded(key: string): string {
  if (!ROOT.startsWith(PREFIX) || !key.startsWith(ROOT)) {
    throw new Error(`refusing to touch ${key}`)
  }
  return key
}

describe.skipIf(process.platform !== 'win32')('win-registry (native, throwaway HKCU key)', () => {
  const real = process.platform === 'win32' ? createWinRegistry() : null
  const registry = {
    getString: (key: string, name: string) => real?.getString('HKCU', guarded(key), name) ?? null,
    setString: (key: string, name: string, value: string) =>
      real?.setString(guarded(key), name, value),
    deleteValue: (key: string, name: string) => real?.deleteValue(guarded(key), name),
    deleteTree: (key: string) => real?.deleteTree(guarded(key)),
  }

  afterAll(() => {
    // Removes the whole throwaway key even if a test failed half way.
    real?.deleteTree(guarded(ROOT))
  })

  it('writes, reads and overwrites a string under a throwaway HKCU key', () => {
    registry.setString(ROOT, 'Value', 'one')
    expect(registry.getString(ROOT, 'Value')).toBe('one')
    registry.setString(ROOT, 'Value', 'two')
    expect(registry.getString(ROOT, 'Value')).toBe('two')
    expect(registry.getString(ROOT, 'Absent')).toBeNull()
    expect(registry.getString(`${ROOT}\\NoSuchKey`, 'Value')).toBeNull()
  })

  it('writes and reads the (Default) value', () => {
    registry.setString(`${ROOT}\\default`, '', 'Scan with StorageIQ')
    expect(registry.getString(`${ROOT}\\default`, '')).toBe('Scan with StorageIQ')
  })

  it('handles non-ASCII text', () => {
    const text = '"D:\\Ứng dụng\\Lê Phong\\StorageIQ.exe" --scan "%V" ✓'
    registry.setString(`${ROOT}\\unicode`, 'Command', text)
    expect(registry.getString(`${ROOT}\\unicode`, 'Command')).toBe(text)
  })

  it('deleteValue removes one value and leaves the rest', () => {
    const key = `${ROOT}\\values`
    registry.setString(key, 'A', 'a')
    registry.setString(key, 'B', 'b')
    registry.deleteValue(key, 'A')
    expect(registry.getString(key, 'A')).toBeNull()
    expect(registry.getString(key, 'B')).toBe('b')
  })

  it('deleteTree removes nested keys', () => {
    registry.setString(`${ROOT}\\tree\\a\\b`, 'Deep', 'x')
    registry.setString(`${ROOT}\\tree`, 'Top', 'y')
    registry.deleteTree(`${ROOT}\\tree`)
    expect(registry.getString(`${ROOT}\\tree\\a\\b`, 'Deep')).toBeNull()
    expect(registry.getString(`${ROOT}\\tree`, 'Top')).toBeNull()
  })

  it('deleting something absent is not an error', () => {
    expect(() => registry.deleteValue(`${ROOT}\\never-made`, 'Nope')).not.toThrow()
    expect(() => registry.deleteValue(ROOT, 'NopeEither')).not.toThrow()
    expect(() => registry.deleteTree(`${ROOT}\\never-made`)).not.toThrow()
  })

  it('refuses names or data that are too long or contain NUL', () => {
    expect(() => registry.setString(ROOT, 'Bad', 'a\u0000b')).toThrow()
    expect(() => registry.setString(ROOT, 'Bad', 'x'.repeat(32_768))).toThrow()
    expect(() => registry.setString(ROOT, 'a\u0000b', 'x')).toThrow()
  })

  it('reads HKLM without throwing', () => {
    const key = 'Software\\Microsoft\\Windows NT\\CurrentVersion'
    const product = real?.getString('HKLM', key, 'ProductName')
    expect(typeof product === 'string' || product === null).toBe(true)
    expect(real?.getString('HKLM', `${key}\\NoSuchKey-${randomUUID()}`, 'x')).toBeNull()
  })

  it('the throwaway key is gone at the end', () => {
    real?.deleteTree(guarded(ROOT))
    expect(registry.getString(ROOT, 'Value')).toBeNull()
    expect(registry.getString(`${ROOT}\\unicode`, 'Command')).toBeNull()
  })
})
