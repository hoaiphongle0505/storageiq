import type { DriveInfo, ScanDone, ScanFailed } from '@shared/scan-types'

/** Run the packaged exe with this switch to check koffi and the scanner process, then exit. */
export const SELF_TEST_FLAG = '--self-test'

export const SELF_TEST_EXIT = {
  ok: 0,
  drivesFailed: 10,
  noDrives: 11,
  nativeNotUnpacked: 12,
  scanFailed: 20,
  asarEntered: 21,
} as const

export interface SelfTestDeps {
  listDrives(): Promise<DriveInfo[]>
  /** Where `koffi.node` must be in a packaged app; `null` when running unpackaged. */
  unpackedNativeModule: string | null
  fileExists(path: string): boolean
  /** The app's `resources` folder, which contains `app.asar`. */
  scanRoot: string
  scanOnce(root: string): Promise<ScanDone | ScanFailed>
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

  const result = await deps.scanOnce(deps.scanRoot)
  if (!('status' in result) || result.status !== 'complete') {
    deps.log(`scan: did not complete (${'status' in result ? result.status : result.message})`)
    return SELF_TEST_EXIT.scanFailed
  }
  if (result.topFolders.some((row) => row.kind === 'folder' && row.name === 'app.asar')) {
    deps.log('scan: walked into app.asar instead of counting it as a file')
    return SELF_TEST_EXIT.asarEntered
  }
  deps.log(`scan: ${result.files} files, ${result.folders} folders`)
  return SELF_TEST_EXIT.ok
}
