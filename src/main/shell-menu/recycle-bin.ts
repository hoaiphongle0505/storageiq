import { ShellMenuError } from './shell-menu-error'

/**
 * The drive root (`C:\`) whose Recycle Bin `target` is, for exactly two shapes: `<root>$RECYCLE.BIN`
 * itself and `<root>$RECYCLE.BIN\<userSid>`, the CURRENT user's folder in it. Case-insensitive.
 * Anything else, including another user's SID folder, a file or anything deeper, is null: that
 * is an ordinary item for the delete verb. `SHEmptyRecycleBinW` always empties the calling user's
 * bin, so it must never be chosen for something else.
 */
export function recycleBinRootOf(target: string, userSid: string | null): string | null {
  const match = /^([A-Za-z]):\\\$RECYCLE\.BIN(?:\\([^\\]+))?\\?$/i.exec(target)
  if (match === null) return null
  const child = match[2]
  if (child !== undefined && (userSid === null || child.toLowerCase() !== userSid.toLowerCase())) {
    return null
  }
  return `${(match[1] ?? '').toUpperCase()}:\\`
}

/** Exactly a drive root such as `C:\`. An empty root would make Windows empty every bin. */
export function isDriveRoot(root: string): boolean {
  return /^[A-Za-z]:\\$/.test(root)
}

/** E_INVALIDARG. */
const E_INVALIDARG = 0x80070057

/** Throws before Windows is called when `root` is not exactly a drive root. */
export function assertDriveRoot(root: string): void {
  if (!isDriveRoot(root)) throw new ShellMenuError('SHEmptyRecycleBinW', E_INVALIDARG)
}

/**
 * `SHEmptyRecycleBinW` results that are not failures: success, S_FALSE, an already empty bin
 * (`E_UNEXPECTED`) and a user cancel (`ERROR_CANCELLED`, `E_ABORT`).
 */
export function isBenignEmptyBinResult(hresult: number): boolean {
  const code = hresult >>> 0
  return code < 0x80000000 || code === 0x8000ffff || code === 0x800704c7 || code === 0x80004004
}
