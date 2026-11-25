import type { RegistryAdapter } from '../registry/registry-adapter'

export const EXPLORER_MENU_LABEL = 'Scan with StorageIQ'

/** Folder, drive and folder-background verbs, under HKCU so no administrator approval is needed. */
export const EXPLORER_KEY_ROOTS: readonly string[] = [
  'Software\\Classes\\Directory\\shell\\StorageIQ',
  'Software\\Classes\\Drive\\shell\\StorageIQ',
  'Software\\Classes\\Directory\\Background\\shell\\StorageIQ',
]

/** `%V` is the folder path for all three keys (a background verb has no `%1`). */
export function explorerCommand(exe: string): string {
  return `"${exe}" --scan "%V"`
}

export function explorerIcon(exe: string): string {
  return `"${exe}",0`
}

/** Writes (or rewrites) all three verbs for `exe`; running it twice writes the same values. */
export function enableExplorerMenu(registry: RegistryAdapter, exe: string): void {
  for (const root of EXPLORER_KEY_ROOTS) {
    registry.setString(root, '', EXPLORER_MENU_LABEL)
    registry.setString(root, 'MUIVerb', EXPLORER_MENU_LABEL)
    registry.setString(root, 'Icon', explorerIcon(exe))
    registry.setString(`${root}\\command`, '', explorerCommand(exe))
  }
}

/** Deletes all three verbs whichever exe they point at; absent keys are fine. */
export function disableExplorerMenu(registry: RegistryAdapter): void {
  for (const root of EXPLORER_KEY_ROOTS) registry.deleteTree(root)
}

/** True only when all three commands are exactly this exe's (case-insensitive). */
export function explorerMenuState(registry: RegistryAdapter, exe: string): boolean {
  const expected = explorerCommand(exe).toLowerCase()
  return EXPLORER_KEY_ROOTS.every(
    (root) => registry.getString('HKCU', `${root}\\command`, '')?.toLowerCase() === expected,
  )
}

/** True when any of the three verbs has left something behind (the owner enabled it once). */
export function explorerMenuTraces(registry: RegistryAdapter): boolean {
  return EXPLORER_KEY_ROOTS.some(
    (root) =>
      registry.getString('HKCU', `${root}\\command`, '') !== null ||
      registry.getString('HKCU', root, '') !== null ||
      registry.getString('HKCU', root, 'MUIVerb') !== null,
  )
}
