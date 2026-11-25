import type { RegistryAdapter, RegistryHive } from './registry-adapter'

export interface FakeRegistry extends RegistryAdapter {
  /** Every value as `hive\0key\0name` (lower-cased) → value, for assertions. */
  entries(): Map<string, string>
  /** Test setup for HKLM, which the adapter itself can never write. */
  seed(hive: RegistryHive, key: string, name: string, value: string): void
  /** Makes every later call throw, as a policy-blocked registry would. */
  failWith(error: Error): void
  /** HKCU writes only (set, delete value, delete tree), in call order. */
  writes: string[]
}

/**
 * An in-memory registry. Key paths and value names live in separate maps, so a value name that
 * contains backslashes (an exe path) can never be mistaken for a deeper key.
 */
export function createFakeRegistry(): FakeRegistry {
  // `hive\0key` (lower-cased) → value name (lower-cased) → value
  const keys = new Map<string, Map<string, string>>()
  let failure: Error | null = null
  const check = () => {
    if (failure !== null) throw failure
  }
  const keyOf = (hive: RegistryHive, key: string) => `${hive}\0${key}`.toLowerCase()
  const put = (hive: RegistryHive, key: string, name: string, value: string) => {
    const id = keyOf(hive, key)
    const values = keys.get(id) ?? new Map<string, string>()
    values.set(name.toLowerCase(), value)
    keys.set(id, values)
  }
  const registry: FakeRegistry = {
    writes: [],
    entries() {
      const flat = new Map<string, string>()
      for (const [id, values] of keys) {
        for (const [name, value] of values) flat.set(`${id}\0${name}`, value)
      }
      return flat
    },
    seed: (hive, key, name, value) => put(hive, key, name, value),
    failWith: (error) => {
      failure = error
    },
    getString(hive, key, name) {
      check()
      return keys.get(keyOf(hive, key))?.get(name.toLowerCase()) ?? null
    },
    setString(key, name, value) {
      check()
      registry.writes.push(`set ${key}\\${name}`)
      put('HKCU', key, name, value)
    },
    deleteValue(key, name) {
      check()
      registry.writes.push(`deleteValue ${key}\\${name}`)
      const id = keyOf('HKCU', key)
      const values = keys.get(id)
      values?.delete(name.toLowerCase())
      if (values?.size === 0) keys.delete(id)
    },
    deleteTree(key) {
      check()
      registry.writes.push(`deleteTree ${key}`)
      const root = keyOf('HKCU', key)
      for (const id of [...keys.keys()]) {
        if (id === root || id.startsWith(`${root}\\`.toLowerCase())) keys.delete(id)
      }
    },
  }
  return registry
}
