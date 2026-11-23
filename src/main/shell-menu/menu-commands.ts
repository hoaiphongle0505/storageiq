/** StorageIQ's own items at the top of the Explorer context menu. */
export type StorageIQMenuItem = 'refresh' | 'copy-path' | 'open' | 'new-folder' | 'delete'

/** Command ids of StorageIQ's items. The shell's items start at `SHELL_FIRST_ID`. */
export const STORAGEIQ_COMMAND_IDS: Readonly<Record<StorageIQMenuItem, number>> = {
  refresh: 1,
  'copy-path': 2,
  open: 3,
  'new-folder': 4,
  delete: 5,
}

/** `IContextMenu::QueryContextMenu` gets ids from here to `SHELL_LAST_ID`. */
export const SHELL_FIRST_ID = 0x100
export const SHELL_LAST_ID = 0x7fff

/** Labels of StorageIQ's items (`&` marks the access key; `\t` starts the shortcut text). */
export const STORAGEIQ_MENU_LABELS = {
  submenu: '&StorageIQ',
  refresh: '&Refresh this folder',
  'copy-path': '&Copy path',
  open: '&Open in Explorer',
  'new-folder': 'New &folder\tCtrl+N',
  delete: 'Delete (move to &Recycle Bin)',
} as const

/** One StorageIQ item of the menu, and whether it sits in the StorageIQ submenu. */
export interface StorageIQMenuEntry {
  item: StorageIQMenuItem
  label: string
  inSubmenu: boolean
}

/**
 * The StorageIQ items shown above the shell's own items. One row: Refresh, Copy path and Open in
 * Explorer in the StorageIQ submenu, then New folder. Several rows: Refresh and Copy paths only
 * (Open in Explorer and New folder act on exactly one row). `sameFolder` is accepted for callers
 * that know it; the set does not depend on it today.
 */
export function storageiqMenuLabels(count: number, sameFolder: boolean): StorageIQMenuEntry[] {
  void sameFolder
  if (count > 1) {
    return [
      { item: 'refresh', label: STORAGEIQ_MENU_LABELS.refresh, inSubmenu: true },
      { item: 'copy-path', label: '&Copy paths', inSubmenu: true },
    ]
  }
  return [
    { item: 'refresh', label: STORAGEIQ_MENU_LABELS.refresh, inSubmenu: true },
    { item: 'copy-path', label: STORAGEIQ_MENU_LABELS['copy-path'], inSubmenu: true },
    { item: 'open', label: STORAGEIQ_MENU_LABELS.open, inSubmenu: true },
    { item: 'new-folder', label: STORAGEIQ_MENU_LABELS['new-folder'], inSubmenu: false },
  ]
}

/** What `TrackPopupMenuEx` returned, in StorageIQ's terms. */
export type MenuCommand =
  | { kind: 'none' }
  | { kind: 'storageiq'; item: StorageIQMenuItem }
  | { kind: 'shell'; offset: number }

export function classifyCommand(id: number): MenuCommand {
  if (!Number.isInteger(id) || id <= 0) return { kind: 'none' }
  if (id >= SHELL_FIRST_ID && id <= SHELL_LAST_ID)
    return { kind: 'shell', offset: id - SHELL_FIRST_ID }
  const entry = Object.entries(STORAGEIQ_COMMAND_IDS).find(([, value]) => value === id)
  return entry === undefined
    ? { kind: 'none' }
    : { kind: 'storageiq', item: entry[0] as StorageIQMenuItem }
}

/** Menu text without access-key markers and shortcut text: `New &folder\tCtrl+N` → `New folder`. */
export function plainMenuLabel(label: string): string {
  const [text = ''] = label.split('\t')
  return text.replace(/&(.)/g, '$1').trim()
}

/**
 * Shell verbs that only read, open or show something. Anything else (delete, cut, paste,
 * rename, restore previous versions, third-party commands, or a command with no verb) may
 * change the folder, so StorageIQ rescans it afterwards.
 */
export const READ_ONLY_VERBS: ReadonlySet<string> = new Set([
  'open',
  'opennewwindow',
  'opennewprocess',
  'opennewtab',
  'explore',
  'find',
  'properties',
  'copy',
  'copyaspath',
  'pintohome',
  'pintostartscreen',
  'runas',
  'openas',
  'print',
  'edit',
  'play',
  'enqueue',
  'preview',
  'sharing',
  'windows.share',
])

export function verbChangesFileSystem(verb: string | null): boolean {
  return verb === null || !READ_ONLY_VERBS.has(verb.toLowerCase())
}

/** Windows' naming for a new folder: "New folder", then "New folder (2)", "New folder (3)", … */
export function nextNewFolderName(existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.toLowerCase()))
  const base = 'New folder'
  if (!taken.has(base.toLowerCase())) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} (${n})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}
