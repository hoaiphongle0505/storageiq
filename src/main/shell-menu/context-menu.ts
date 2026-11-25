import path from 'node:path'
import type { StorageIQMenuItem } from './menu-commands'
import { SHELL_FIRST_ID } from './menu-commands'

export interface ShellMenuRequest {
  /** Absolute paths from the scanner, 1 to 1,000. */
  paths: string[]
  /** Screen pixels. */
  x: number
  y: number
  /** Shift was held at the click: also show the extended verbs (Copy as path, Open PowerShell here, …). */
  extended: boolean
  /** The root of the scan: the worker removes Delete, Cut and Rename from the shell's items. */
  hideDestructive: boolean
}

export type ShellMenuChoice =
  | { kind: 'dismissed' }
  | { kind: 'storageiq'; item: StorageIQMenuItem }
  | { kind: 'shell'; verb: string | null; changed: boolean }

/** How the shell command ended: it returned, or it failed with an HRESULT at `step`. */
export type ShellFinish = { ok: true } | { ok: false; hresult: number; step: string }

/**
 * Runs Explorer menus on native worker threads, so a long shell operation never blocks the UI
 * thread. `chosen` resolves when the menu closes (before the command runs); `finished` when the
 * command returned. Neither blocks the UI thread.
 */
export interface ShellMenuHost {
  /**
   * Starts a menu. Throws `ShellBusyError` synchronously when three actions already run (and an
   * `Error` after `dispose`); it does not return a rejected promise for those.
   */
  show(request: ShellMenuRequest): {
    chosen: Promise<ShellMenuChoice>
    finished: Promise<ShellFinish>
  }
  /** Builds the menu for `paths` without showing it and returns its labels (`''` = separator). */
  probe(paths: string[], hideDestructive?: boolean): Promise<string[]>
  /**
   * Keyboard Delete: runs the shell's delete verb for `paths` with no menu (`permanent` is
   * Shift+Delete). Resolves when the command returned. Throws `ShellBusyError` synchronously
   * when three actions already run.
   */
  deleteItems(paths: string[], permanent: boolean): Promise<ShellFinish>
  /**
   * Empties the Recycle Bin of the drive `root` with `SHEmptyRecycleBinW` (Windows asks for
   * confirmation and shows progress). Throws `ShellBusyError` synchronously like `deleteItems`.
   */
  emptyRecycleBin(root: string): Promise<ShellFinish>
  /** Terminates every worker and rejects pending requests. */
  dispose(): void
}

/** Where a menu's IContextMenu comes from. */
export type MenuRoute = 'single' | 'parent' | 'default'

const parentOf = (target: string): string => path.win32.dirname(target).toLowerCase()

/**
 * One path: the item's own parent folder. Several paths with the same parent: that parent folder
 * with all child ids (full menu). Several parents: `SHCreateDefaultContextMenu` with the desktop
 * folder and absolute PIDLs (reduced menu).
 */
export function chooseRoute(paths: readonly string[]): MenuRoute {
  if (paths.length <= 1) return 'single'
  const first = parentOf(paths[0] ?? '')
  return paths.every((target) => parentOf(target) === first) ? 'parent' : 'default'
}

/** What `hideDestructiveVerbs` needs from a native menu. */
export interface MenuItemOps {
  count(): number
  /** Command id of the item at `position` (0 for popups and separators). */
  idAt(position: number): number
  /** The shell's verb for an offset from `SHELL_FIRST_ID`, or null. */
  verbOf(offset: number): string | null
  removeAt(position: number): void
}

const DESTRUCTIVE_VERBS: ReadonlySet<string> = new Set(['delete', 'cut', 'rename'])

/** Removes the shell's Delete, Cut and Rename items; returns how many were removed. */
export function hideDestructiveVerbs(ops: MenuItemOps): number {
  let removed = 0
  for (let position = ops.count() - 1; position >= 0; position -= 1) {
    const id = ops.idAt(position)
    if (id < SHELL_FIRST_ID) continue
    const verb = ops.verbOf(id - SHELL_FIRST_ID)
    if (verb !== null && DESTRUCTIVE_VERBS.has(verb.toLowerCase())) {
      ops.removeAt(position)
      removed += 1
    }
  }
  return removed
}
