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
  scanFailed: 20,
  asarEntered: 21,
} as const

/** A real Explorer menu has Open, Copy, Properties and more; fewer items means COM failed. */
export const MIN_SHELL_MENU_ITEMS = 5

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
  deps.log(`scan: ${result.done.files} files, ${result.done.folders} folders`)
  return SELF_TEST_EXIT.ok
}
