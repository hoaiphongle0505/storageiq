import { describe, expect, it } from 'vitest'
import { createFakeRegistry } from './fake-registry'

describe('fake registry', () => {
  it('keeps key paths and value names apart even with backslashes in the name', () => {
    const registry = createFakeRegistry()
    registry.setString('Software\\Layers', 'C:\\App\\StorageIQ.exe', '~ RUNASADMIN')
    expect(registry.getString('HKCU', 'Software\\Layers', 'C:\\App\\StorageIQ.exe')).toBe(
      '~ RUNASADMIN',
    )
    expect(registry.getString('HKCU', 'Software\\Layers\\C:\\App', 'StorageIQ.exe')).toBeNull()
    expect(registry.getString('HKCU', 'Software\\Layers\\C:\\App\\StorageIQ.exe', '')).toBeNull()
  })

  it('deleteTree removes a key and its children but not a sibling with the same prefix', () => {
    const registry = createFakeRegistry()
    registry.setString('A\\B', 'x', '1')
    registry.setString('A\\B\\C', '', '2')
    registry.setString('A\\BB', 'x', '3')
    registry.deleteTree('A\\B')
    expect(registry.getString('HKCU', 'A\\B', 'x')).toBeNull()
    expect(registry.getString('HKCU', 'A\\B\\C', '')).toBeNull()
    expect(registry.getString('HKCU', 'A\\BB', 'x')).toBe('3')
  })
})
