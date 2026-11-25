import { describe, expect, it } from 'vitest'
import { createFakeRegistry } from '../registry/fake-registry'
import {
  disableExplorerMenu,
  enableExplorerMenu,
  EXPLORER_KEY_ROOTS,
  EXPLORER_MENU_LABEL,
  explorerCommand,
  explorerIcon,
  explorerMenuState,
} from './explorer-menu'

const EXE = 'C:\\Program Files\\StorageIQ\\StorageIQ.exe'

describe('explorer menu', () => {
  it('writes all three keys with label, MUIVerb, icon and command', () => {
    const registry = createFakeRegistry()
    enableExplorerMenu(registry, EXE)
    expect(EXPLORER_KEY_ROOTS).toEqual([
      'Software\\Classes\\Directory\\shell\\StorageIQ',
      'Software\\Classes\\Drive\\shell\\StorageIQ',
      'Software\\Classes\\Directory\\Background\\shell\\StorageIQ',
    ])
    for (const root of EXPLORER_KEY_ROOTS) {
      expect(registry.getString('HKCU', root, '')).toBe('Scan with StorageIQ')
      expect(registry.getString('HKCU', root, 'MUIVerb')).toBe(EXPLORER_MENU_LABEL)
      expect(registry.getString('HKCU', root, 'Icon')).toBe(explorerIcon(EXE))
      expect(registry.getString('HKCU', `${root}\\command`, '')).toBe(explorerCommand(EXE))
    }
  })

  it('uses %V in every command', () => {
    const registry = createFakeRegistry()
    enableExplorerMenu(registry, EXE)
    for (const root of EXPLORER_KEY_ROOTS) {
      const command = registry.getString('HKCU', `${root}\\command`, '') ?? ''
      expect(command).toContain('"%V"')
      expect(command).not.toContain('%1')
    }
  })

  it('quotes the exe path and the icon path', () => {
    expect(explorerCommand(EXE)).toBe(`"${EXE}" --scan "%V"`)
    expect(explorerIcon(EXE)).toBe(`"${EXE}",0`)
  })

  it('handles an exe path with spaces and non-ASCII letters', () => {
    const exe = 'D:\\Ứng dụng\\Lê Phong\\StorageIQ.exe'
    const registry = createFakeRegistry()
    enableExplorerMenu(registry, exe)
    expect(explorerMenuState(registry, exe)).toBe(true)
    expect(registry.getString('HKCU', `${EXPLORER_KEY_ROOTS[0]}\\command`, '')).toBe(
      `"${exe}" --scan "%V"`,
    )
  })

  it('is idempotent when registered twice', () => {
    const registry = createFakeRegistry()
    enableExplorerMenu(registry, EXE)
    const first = new Map(registry.entries())
    enableExplorerMenu(registry, EXE)
    expect(registry.entries()).toEqual(first)
  })

  it('removing deletes all three trees and is idempotent', () => {
    const registry = createFakeRegistry()
    enableExplorerMenu(registry, EXE)
    disableExplorerMenu(registry)
    expect(registry.entries().size).toBe(0)
    expect(() => disableExplorerMenu(registry)).not.toThrow()
    expect(registry.entries().size).toBe(0)
  })

  it('state is off when a command points at another exe', () => {
    const registry = createFakeRegistry()
    enableExplorerMenu(registry, 'C:\\Old\\StorageIQ.exe')
    expect(explorerMenuState(registry, EXE)).toBe(false)
  })

  it('state is on only when all three commands match', () => {
    const registry = createFakeRegistry()
    enableExplorerMenu(registry, EXE)
    expect(explorerMenuState(registry, EXE)).toBe(true)
    expect(explorerMenuState(registry, EXE.toLowerCase())).toBe(true)
    registry.deleteTree(EXPLORER_KEY_ROOTS[1] ?? '')
    expect(explorerMenuState(registry, EXE)).toBe(false)
  })
})
