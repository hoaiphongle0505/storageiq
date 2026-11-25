export interface WhatsNewStoreDeps {
  filePath: string
  readFile(file: string): Promise<string>
  writeFile(file: string, text: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  log(message: string, error?: unknown): void
}

export interface WhatsNewStore {
  /** The last version whose What's new was handled; null when missing or unreadable. */
  read(): Promise<string | null>
  /** Atomic write (temp file, then rename); a failure is logged, never thrown. */
  write(version: string): Promise<void>
}

export function createWhatsNewStore(deps: WhatsNewStoreDeps): WhatsNewStore {
  return {
    async read() {
      try {
        const parsed: unknown = JSON.parse(await deps.readFile(deps.filePath))
        const value = (parsed as { lastSeenVersion?: unknown } | null)?.lastSeenVersion
        return typeof value === 'string' ? value : null
      } catch {
        return null
      }
    },
    async write(version) {
      const temp = `${deps.filePath}.tmp`
      try {
        await deps.writeFile(temp, JSON.stringify({ lastSeenVersion: version }))
        await deps.rename(temp, deps.filePath)
      } catch (error) {
        deps.log('Could not save the version whose release notes were shown', error)
      }
    },
  }
}
