export interface AppSettingsStoreDeps {
  filePath: string
  readFile(file: string): Promise<string>
  writeFile(file: string, text: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  log(message: string, error?: unknown): void
}

export interface AppSettingsStore {
  /** Whether StorageIQ checks for updates by itself; true when missing, corrupt or unreadable. */
  readAutoUpdate(): Promise<boolean>
  /** Atomic write (temp file, then rename); a failure is logged, never thrown. */
  writeAutoUpdate(enabled: boolean): Promise<void>
}

/** StorageIQ's own small settings file in `userData` (the Windows options live in the registry). */
export function createAppSettingsStore(deps: AppSettingsStoreDeps): AppSettingsStore {
  return {
    async readAutoUpdate() {
      try {
        const parsed: unknown = JSON.parse(await deps.readFile(deps.filePath))
        const value = (parsed as { autoUpdate?: unknown } | null)?.autoUpdate
        return typeof value === 'boolean' ? value : true
      } catch {
        return true
      }
    },
    async writeAutoUpdate(enabled) {
      const temp = `${deps.filePath}.tmp`
      try {
        await deps.writeFile(temp, JSON.stringify({ autoUpdate: enabled }))
        await deps.rename(temp, deps.filePath)
      } catch (error) {
        deps.log('Could not save the automatic update setting', error)
      }
    },
  }
}
