import { describe, expect, it, vi } from 'vitest'
import type { DriveInfo, ScanDone, ScanFailed } from '@shared/scan-types'
import { runSelfTest, SELF_TEST_EXIT, type SelfTestDeps } from './self-test'

const DRIVES: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 100, freeBytes: 40 },
]
const NATIVE = 'C:\\App\\resources\\app.asar.unpacked\\koffi.node'

function scanDone(overrides: Partial<ScanDone> = {}): ScanDone {
  return {
    scanId: 'self-test',
    status: 'complete',
    files: 3,
    folders: 1,
    bytes: 900,
    elapsedMs: 20,
    topFolders: [
      {
        kind: 'folder',
        name: 'app.asar.unpacked',
        path: 'C:\\App\\resources\\app.asar.unpacked',
        bytes: 600,
        files: 2,
        folders: 0,
      },
      {
        kind: 'everything-else',
        name: 'Everything else',
        path: 'C:\\App\\resources',
        bytes: 300,
        files: 1,
        folders: 0,
      },
    ],
    errors: [],
    errorCount: 0,
    ...overrides,
  }
}

function setup(overrides: Partial<SelfTestDeps> = {}) {
  const lines: string[] = []
  const deps: SelfTestDeps = {
    listDrives: vi.fn(async () => DRIVES),
    unpackedNativeModule: NATIVE,
    fileExists: vi.fn(() => true),
    scanRoot: 'C:\\App\\resources',
    scanOnce: vi.fn(async (): Promise<ScanDone | ScanFailed> => scanDone()),
    log: (line) => {
      lines.push(line)
    },
    ...overrides,
  }
  return { deps, lines }
}

describe('runSelfTest', () => {
  it('passes when koffi lists drives from the unpacked module and the scanner completes', async () => {
    const { deps, lines } = setup()
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.ok)
    expect(deps.fileExists).toHaveBeenCalledWith(NATIVE)
    expect(deps.scanOnce).toHaveBeenCalledWith('C:\\App\\resources')
    expect(lines).toContain('drives: C:\\')
  })

  it('fails when koffi cannot list drives', async () => {
    const { deps } = setup({ listDrives: vi.fn().mockRejectedValue(new Error('no koffi.node')) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.drivesFailed)
  })

  it('fails when no drive is listed', async () => {
    const { deps } = setup({ listDrives: vi.fn(async () => []) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.noDrives)
  })

  it('fails when the packaged native module is not unpacked', async () => {
    const { deps } = setup({ fileExists: vi.fn(() => false) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.nativeNotUnpacked)
  })

  it('skips the unpacked check when running unpackaged', async () => {
    const { deps } = setup({ unpackedNativeModule: null })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.ok)
    expect(deps.fileExists).not.toHaveBeenCalled()
  })

  it('fails when the scanner process fails', async () => {
    const failed: ScanFailed = { scanId: 'self-test', message: 'crashed' }
    const { deps } = setup({ scanOnce: vi.fn(async () => failed) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.scanFailed)
  })

  it('fails when the scan does not complete', async () => {
    const { deps } = setup({ scanOnce: vi.fn(async () => scanDone({ status: 'canceled' })) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.scanFailed)
  })

  it('fails when the scanner walked into app.asar instead of counting it as a file', async () => {
    const done = scanDone({
      topFolders: [
        {
          kind: 'folder',
          name: 'app.asar',
          path: 'C:\\App\\resources\\app.asar',
          bytes: 1,
          files: 1,
          folders: 0,
        },
      ],
    })
    const { deps } = setup({ scanOnce: vi.fn(async () => done) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.asarEntered)
  })
})
