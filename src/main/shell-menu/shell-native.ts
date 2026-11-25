import type { MenuRoute } from './context-menu'

/** One built menu: StorageIQ's items, a separator, then the shell's items (or the fallback). */
export interface BuiltShellMenu {
  /** Item labels at the top level, in order (`''` for separators). */
  labels(): string[]
  /** The owner window's handle as a decimal string (for WM_CANCELMODE from main). */
  ownerHandle(): string
  /** Shows the menu at screen pixel `x`, `y` and waits; returns the chosen id (0 = none). */
  track(x: number, y: number): number
  /** The shell's verb for an item (`delete`, `properties`, …), or null when it has none. */
  verb(offset: number): string | null
  /** The offset of the shell item with this verb, or null. */
  offsetOfVerb(verb: string): number | null
  /** Runs the shell's item as Explorer would; Shift/Ctrl are read from the live key state. */
  invoke(offset: number, x: number, y: number): void
  /**
   * Keyboard delete: runs the `"delete"` verb by name, with no menu shown. `permanent` sets
   * SHIFT_DOWN (Explorer's Shift+Delete). `noUi` is for native tests only. Windows shows its own confirmation and progress dialogs.
   */
  invokeDelete(permanent: boolean, noUi?: boolean): void
  /** Fallback menu only: recycles the items with IFileOperation; returns when it finished. */
  recycle(): void
  /** Destroys the menu and releases every COM object and the owner window. */
  release(): void
}

export interface BuildOptions {
  extended: boolean
  hideDestructive: boolean
}

/** The Windows side (koffi), used by the worker; tests pass a fake. Everything is synchronous. */
export interface ShellNative {
  build(route: MenuRoute, paths: readonly string[], options: BuildOptions): BuiltShellMenu
  /** `SHEmptyRecycleBinW` for the drive `root` with confirmation and progress (flags 0). */
  emptyRecycleBin(root: string): void
  /** StorageIQ-only menu (Refresh, Copy paths, Delete) for when the default menu cannot be built. */
  buildFallback(paths: readonly string[]): BuiltShellMenu
}
