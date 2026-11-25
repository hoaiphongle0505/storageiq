/**
 * The drive root (`C:\`) whose Recycle Bin `target` is: `<root>$RECYCLE.BIN` itself or one folder
 * directly inside it (a per-user SID folder). Case-insensitive; anything else is null. Deleting
 * such a folder with the delete verb walks every item in it, so main empties the bin instead.
 */
export function recycleBinRootOf(target: string): string | null {
  const match = /^([A-Za-z]):\\\$RECYCLE\.BIN(?:\\[^\\]+)?\\?$/i.exec(target)
  return match === null ? null : `${(match[1] ?? '').toUpperCase()}:\\`
}
