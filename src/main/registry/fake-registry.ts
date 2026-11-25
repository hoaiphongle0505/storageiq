import type { RegistryAdapter, RegistryHive } from './registry-adapter'

export interface FakeRegistry extends RegistryAdapter {
  /** Every `hive\key\name` (lower-cased) → value, for assertions. */
  entries(): Map<string, string>
  /** Test setup for HKLM, which the adapter itself can never write. */
  seed(hive: RegistryHive, key: string, name: string, value: string): void
  /** Makes every later call throw, as a policy-blocked registry would. */
  failWith(error: Error): void
  /** HKCU writes only (set, delete value, delete tree), in call order. */
  writes: string[]
}

const slot = (hive: RegistryHive, key: string, name: string) =>
  `${hive}\\${key}\\${name}`.toLowerCase()

/** An in-memory registry keyed by lower-cased `hive\key\name`. */
export function createFakeRegistry(): FakeRegistry {
  const values = new Map<string, string>()
  let failure: Error | null = null
  const check = () => {
    if (failure !== null) throw failure
  }
  const registry: FakeRegistry = {
    writes: [],
    entries: () => values,
    seed: (hive, key, name, value) => {
      values.set(slot(hive, key, name), value)
    },
    failWith: (error) => {
      failure = error
    },
    getString(hive, key, name) {
      check()
      return values.get(slot(hive, key, name)) ?? null
    },
    setString(key, name, value) {
      check()
      registry.writes.push(`set ${key}\\${name}`)
      values.set(slot('HKCU', key, name), value)
    },
    deleteValue(key, name) {
      check()
      registry.writes.push(`deleteValue ${key}\\${name}`)
      values.delete(slot('HKCU', key, name))
    },
    deleteTree(key) {
      check()
      registry.writes.push(`deleteTree ${key}`)
      const prefix = slot('HKCU', key, '')
      for (const existing of [...values.keys()]) {
        if (existing === prefix.slice(0, -1) || existing.startsWith(prefix)) {
          values.delete(existing)
        }
      }
    },
  }
  return registry
}
