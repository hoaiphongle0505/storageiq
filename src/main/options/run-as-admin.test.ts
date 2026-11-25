import { describe, expect, it } from 'vitest'
import { createFakeRegistry } from '../registry/fake-registry'
import { disableRunAsAdmin, enableRunAsAdmin, LAYERS_KEY, readRunAsAdmin } from './run-as-admin'

const EXE = 'C:\\Program Files\\StorageIQ\\StorageIQ.exe'

describe('run as administrator', () => {
  it('writes the flag under the AppCompatFlags Layers key named by the exe path', () => {
    const registry = createFakeRegistry()
    enableRunAsAdmin(registry, EXE)
    expect(LAYERS_KEY).toBe(
      'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
    )
    expect(registry.getString('HKCU', LAYERS_KEY, EXE)).toBe('~ RUNASADMIN')
  })

  it('preserves other flags when enabling', () => {
    const registry = createFakeRegistry()
    registry.seed('HKCU', LAYERS_KEY, EXE, '~ WIN7RTM')
    enableRunAsAdmin(registry, EXE)
    expect(registry.getString('HKCU', LAYERS_KEY, EXE)).toBe('~ WIN7RTM RUNASADMIN')
  })

  it('removes only the flag and keeps the others', () => {
    const registry = createFakeRegistry()
    registry.seed('HKCU', LAYERS_KEY, EXE, '~ WIN7RTM RUNASADMIN')
    disableRunAsAdmin(registry, EXE)
    expect(registry.getString('HKCU', LAYERS_KEY, EXE)).toBe('~ WIN7RTM')
  })

  it('deletes the value when nothing else remains', () => {
    const registry = createFakeRegistry()
    enableRunAsAdmin(registry, EXE)
    disableRunAsAdmin(registry, EXE)
    expect(registry.getString('HKCU', LAYERS_KEY, EXE)).toBeNull()
    expect(registry.entries().size).toBe(0)
  })

  it('reads HKLM and reports locked', () => {
    const registry = createFakeRegistry()
    expect(readRunAsAdmin(registry, EXE)).toEqual({ enabled: false, locked: false })
    registry.seed('HKLM', LAYERS_KEY, EXE, '~ RUNASADMIN')
    expect(readRunAsAdmin(registry, EXE)).toEqual({ enabled: true, locked: true })
    const user = createFakeRegistry()
    enableRunAsAdmin(user, EXE)
    expect(readRunAsAdmin(user, EXE)).toEqual({ enabled: true, locked: false })
  })

  it('never writes HKLM', () => {
    const registry = createFakeRegistry()
    registry.seed('HKLM', LAYERS_KEY, EXE, '~ RUNASADMIN')
    enableRunAsAdmin(registry, EXE)
    disableRunAsAdmin(registry, EXE)
    expect(registry.getString('HKLM', LAYERS_KEY, EXE)).toBe('~ RUNASADMIN')
    expect([...registry.entries().keys()].filter((key) => !key.startsWith('hklm'))).toEqual([])
  })

  it('a disable of an absent value succeeds', () => {
    const registry = createFakeRegistry()
    expect(() => disableRunAsAdmin(registry, EXE)).not.toThrow()
    expect(registry.getString('HKCU', LAYERS_KEY, EXE)).toBeNull()
  })
})
