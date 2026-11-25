import type { DriveInfo, ScanDone, ScanFailed } from '@shared/scan-types'
import type { TreeRow } from '@shared/tree-types'

/** Run the packaged exe with this switch to check koffi and the scanner process, then exit. */
export const SELF_TEST_FLAG = '--self-test'

export const SELF_TEST_EXIT = {
  ok: 0,
  drivesFailed: 10,
  noDrives: 11,
  nativeNotUnpacked: 12,
  shellMenuFailed: 13,
  iconFailed: 14,
  registryFailed: 15,
  scanFailed: 20,
  asarEntered: 21,
  walkEmpty: 22,
  parallelWalkFailed: 23,
} as const

/** A real Explorer menu has Open, Copy, Properties and more; fewer items means COM failed. */
export const MIN_SHELL_MENU_ITEMS = 5

/**
 * Base64 of the PNG signature (89 50 4E 47 0D 0A 1A 0A) after the data URL header: every PNG the
 * icon worker returns starts with it.
 */
export const PNG_DATA_URL_PREFIX = 'data:image/png;base64,iVBORw0KGgo'

/** One finished scan plus the scanned root's direct child rows. */
export type SelfTestScan = { done: ScanDone; rootChildren: TreeRow[] } | { failed: ScanFailed }

export interface SelfTestDeps {
  listDrives(): Promise<DriveInfo[]>
  /** Where `koffi.node` must be in a packaged app; `null` when running unpackaged. */
  unpackedNativeModule: string | null
  fileExists(path: string): boolean
  /** The app's `resources` folder, which contains `app.asar`. */
  scanRoot: string
  scanOnce(root: string): Promise<SelfTestScan>
  /** Labels of the Explorer context menu for `path`, built and destroyed without showing it. */
  probeShellMenu(path: string): Promise<string[]>
  /** The icon worker's small `.txt` icon as a data URL; empty when the worker did not answer. */
  probeIcon(): Promise<string>
  /** Writes, reads and deletes a value under a throwaway HKCU key; throws when it fails. */
  probeRegistry(): void
  log(line: string): void
}

export async function runSelfTest(deps: SelfTestDeps): Promise<number> {
  let drives: DriveInfo[]
  try {
    drives = await deps.listDrives()
  } catch (error) {
    deps.log(`drives: koffi failed: ${String(error)}`)
    return SELF_TEST_EXIT.drivesFailed
  }
  if (drives.length === 0) {
    deps.log('drives: none found')
    return SELF_TEST_EXIT.noDrives
  }
  deps.log(`drives: ${drives.map((drive) => drive.root).join(' ')}`)

  if (deps.unpackedNativeModule !== null && !deps.fileExists(deps.unpackedNativeModule)) {
    deps.log(`koffi: ${deps.unpackedNativeModule} is missing`)
    return SELF_TEST_EXIT.nativeNotUnpacked
  }

  let labels: string[]
  try {
    labels = await deps.probeShellMenu(deps.scanRoot)
  } catch (error) {
    deps.log(`shell menu: ${String(error)}`)
    return SELF_TEST_EXIT.shellMenuFailed
  }
  const shellItems = labels.filter((label) => label !== '').length
  if (shellItems <= MIN_SHELL_MENU_ITEMS) {
    deps.log(`shell menu: only ${shellItems} items (${labels.join(' | ')})`)
    return SELF_TEST_EXIT.shellMenuFailed
  }
  deps.log(`shell menu: ${shellItems} items`)

  // The icon worker thread (icon-worker.js) must load koffi and answer with a PNG.
  let icon: string
  try {
    icon = await deps.probeIcon()
  } catch (error) {
    deps.log(`icon: ${String(error)}`)
    return SELF_TEST_EXIT.iconFailed
  }
  if (!icon.startsWith(PNG_DATA_URL_PREFIX)) {
    deps.log('icon: the icon worker did not return a PNG')
    return SELF_TEST_EXIT.iconFailed
  }
  deps.log('icon: ext:txt PNG')

  try {
    deps.probeRegistry()
  } catch (error) {
    deps.log(`registry round trip: ${String(error)}`)
    return SELF_TEST_EXIT.registryFailed
  }
  deps.log('registry round trip: ok')

  const result = await deps.scanOnce(deps.scanRoot)
  if ('failed' in result) {
    deps.log(`scan: did not complete (${result.failed.message})`)
    return SELF_TEST_EXIT.scanFailed
  }
  if (result.done.status !== 'complete') {
    deps.log(`scan: did not complete (${result.done.status})`)
    return SELF_TEST_EXIT.scanFailed
  }
  if (result.rootChildren.some((row) => row.kind === 'folder' && row.name === 'app.asar')) {
    deps.log('scan: walked into app.asar instead of counting it as a file')
    return SELF_TEST_EXIT.asarEntered
  }
  // The listing must report real sizes: a walk that found nothing, or only zero-byte files,
  // means the disk reader (koffi in the scanner process) is not working.
  const hasBytes = result.rootChildren.some(
    (row) => (row.kind === 'file' || row.kind === 'files') && row.size > 0,
  )
  if (result.done.files === 0 || !hasBytes) {
    deps.log(`scan: the walk found no file with a size (${result.done.files} files)`)
    return SELF_TEST_EXIT.walkEmpty
  }
  deps.log(
    `scan: ${result.done.files} files, ${result.done.folders} folders, ${result.done.walkers ?? 1} walkers`,
  )
  // Packaged only: the scan must have run on the walker pool, else the worker script or koffi
  // in a worker thread did not load and the scanner silently fell back to one thread.
  if (deps.unpackedNativeModule !== null && (result.done.walkers ?? 1) < 2) {
    deps.log('walk: only 1 walker (pool did not start)')
    return SELF_TEST_EXIT.parallelWalkFailed
  }
  return SELF_TEST_EXIT.ok
}
