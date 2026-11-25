import type { RegistryAdapter } from '../registry/registry-adapter'
import { addRunAsAdmin, removeRunAsAdmin } from './layers-flags'

/** The per-user compatibility-layer list; the value name is the exe's full path. */
export const LAYERS_KEY = 'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'

const hasFlag = (value: string | null) =>
  value !== null && value.split(/\s+/).some((token) => token.toUpperCase() === 'RUNASADMIN')

/** `enabled` when HKCU or HKLM has the flag; `locked` when HKLM has it (not ours to change). */
export function readRunAsAdmin(
  registry: RegistryAdapter,
  exe: string,
): { enabled: boolean; locked: boolean } {
  const user = hasFlag(registry.getString('HKCU', LAYERS_KEY, exe))
  const machine = hasFlag(registry.getString('HKLM', LAYERS_KEY, exe))
  return { enabled: user || machine, locked: machine }
}

/** Sets the flag in HKCU only, keeping any other flags. */
export function enableRunAsAdmin(registry: RegistryAdapter, exe: string): void {
  const existing = registry.getString('HKCU', LAYERS_KEY, exe)
  const next = addRunAsAdmin(existing)
  if (next !== existing) registry.setString(LAYERS_KEY, exe, next)
}

/** Clears the flag in HKCU only; deletes the value when nothing else remains. */
export function disableRunAsAdmin(registry: RegistryAdapter, exe: string): void {
  const existing = registry.getString('HKCU', LAYERS_KEY, exe)
  if (existing === null) return
  const next = removeRunAsAdmin(existing)
  if (next === null) registry.deleteValue(LAYERS_KEY, exe)
  else if (next !== existing) registry.setString(LAYERS_KEY, exe, next)
}
