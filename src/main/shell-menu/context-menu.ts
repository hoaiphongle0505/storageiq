import { classifyCommand, type StorageIQMenuItem, verbChangesFileSystem } from './menu-commands'

/** One built menu: StorageIQ's items, a separator, then the shell's items for one path. */
export interface BuiltShellMenu {
  /** Item labels at the top level, in order (`''` for separators). */
  labels(): string[]
  /** Shows the menu at screen pixel `x`, `y` and waits; returns the chosen id (0 = none). */
  track(x: number, y: number): number
  /** The shell's verb for an item (`delete`, `properties`, …), or null when it has none. */
  verb(offset: number): string | null
  /** Runs the shell's item as Explorer would; Shift/Ctrl are read from the live key state. */
  invoke(offset: number, x: number, y: number): void
  /** Destroys the menu and releases every COM object. */
  release(): void
}

/** The Windows side, built with koffi in `win-shell-menu.ts`; tests pass a fake. */
export interface ShellMenuNative {
  build(hwnd: bigint, path: string, extended: boolean): BuiltShellMenu
}

export interface ShellMenuRequest {
  hwnd: bigint
  path: string
  /** Screen pixels. */
  x: number
  y: number
  /** Shift was held at the click: also show the extended verbs (Copy as path, Open PowerShell here, …). */
  extended: boolean
}

export type ShellMenuChoice =
  | { kind: 'dismissed' }
  | { kind: 'storageiq'; item: StorageIQMenuItem }
  | { kind: 'shell'; verb: string | null; changed: boolean }

/** Shows the real Explorer context menu and runs the shell command the user picks. */
export function showShellMenu(native: ShellMenuNative, request: ShellMenuRequest): ShellMenuChoice {
  const menu = native.build(request.hwnd, request.path, request.extended)
  try {
    const command = classifyCommand(menu.track(request.x, request.y))
    if (command.kind === 'none') return { kind: 'dismissed' }
    if (command.kind === 'storageiq') return { kind: 'storageiq', item: command.item }
    const verb = menu.verb(command.offset)
    menu.invoke(command.offset, request.x, request.y)
    return { kind: 'shell', verb, changed: verbChangesFileSystem(verb) }
  } finally {
    menu.release()
  }
}

/** Test seam: builds the menu without showing it and returns its labels. */
export function probeShellMenu(native: ShellMenuNative, hwnd: bigint, path: string): string[] {
  const menu = native.build(hwnd, path, false)
  try {
    return menu.labels()
  } finally {
    menu.release()
  }
}
