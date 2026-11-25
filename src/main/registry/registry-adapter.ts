/** The Windows registry as main needs it; the real one is `win-registry.ts`, tests use a fake. */
export type RegistryHive = 'HKCU' | 'HKLM'

/** Every key path is relative to the hive root. */
export interface RegistryAdapter {
  /** REG_SZ value; `name === ''` is the key’s (Default). null when the key or value is absent. */
  getString(hive: RegistryHive, key: string, name: string): string | null
  /** Creates the key (and parents) if needed, then writes a REG_SZ. HKCU only. */
  setString(key: string, name: string, value: string): void
  /** Deletes one value; a missing key or value is not an error. HKCU only. */
  deleteValue(key: string, name: string): void
  /** Deletes the key and everything below it; a missing key is not an error. HKCU only. */
  deleteTree(key: string): void
}
