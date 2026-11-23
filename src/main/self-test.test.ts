import { describe, expect, it, vi } from 'vitest'
import type { DriveInfo, ScanDone, ScanFailed } from '@shared/scan-types'
import type { TreeRow } from '@shared/tree-types'
import { runSelfTest, SELF_TEST_EXIT, type SelfTestDeps, type SelfTestScan } from './self-test'

const DRIVES: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 100, freeBytes: 40 },
]
const NATIVE = 'C:\\App\\resources\\app.asar.unpacked\\koffi.node'
const MENU = ['StorageIQ', 'New folder', '', 'Open', 'Copy', 'Cut', 'Delete', 'Properties']

function row(name: string, kind: TreeRow['kind']): TreeRow {
  return {
    id: kind === 'folder' ? 'd1' : 'g0',
    parentId: 'd0',
    kind,
    name,
    size: 1,
    allocated: 4096,
    files: 1,
    folders: 0,
    modifiedMs: 0,
    childCount: 1,
  }
}

function scanDone(overrides: Partial<ScanDone> = {}): ScanDone {
  return {
    scanId: 'self-test',
    status: 'complete',
    files: 3,
    folders: 1,
    bytes: 900,
    allocatedBytes: 12_288,
    elapsedMs: 20,
    errors: [],
    errorCount: 0,
    walkers: 4,
    ...overrides,
  }
}

const completed = (
  done = scanDone(),
  rootChildren = [row('app.asar.unpacked', 'folder'), row('', 'files')],
): SelfTestScan => ({ done, rootChildren })

function setup(overrides: Partial<SelfTestDeps> = {}) {
  const lines: string[] = []
  const deps: SelfTestDeps = {
    listDrives: vi.fn(async () => DRIVES),
    unpackedNativeModule: NATIVE,
    fileExists: vi.fn(() => true),
    scanRoot: 'C:\\App\\resources',
    scanOnce: vi.fn(async () => completed()),
    probeShellMenu: vi.fn(async () => MENU),
    log: (line) => {
      lines.push(line)
    },
    ...overrides,
  }
  return { deps, lines }
}

describe('runSelfTest', () => {
  it('passes when koffi lists drives, builds the shell menu and the scanner completes', async () => {
    const { deps, lines } = setup()
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.ok)
    expect(deps.fileExists).toHaveBeenCalledWith(NATIVE)
    expect(deps.scanOnce).toHaveBeenCalledWith('C:\\App\\resources')
    expect(deps.probeShellMenu).toHaveBeenCalledWith('C:\\App\\resources')
    expect(lines).toContain('drives: C:\\')
    expect(lines).toContain('shell menu: 7 items')
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

  it('fails when the shell menu cannot be built', async () => {
    const { deps } = setup({ probeShellMenu: vi.fn().mockRejectedValue(new Error('E_FAIL')) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.shellMenuFailed)
  })

  it('fails when the shell menu has only StorageIQ’s own items', async () => {
    const { deps } = setup({ probeShellMenu: vi.fn(async () => ['StorageIQ', 'New folder', '']) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.shellMenuFailed)
  })

  it('fails when the scanner process fails', async () => {
    const failed: ScanFailed = { scanId: 'self-test', message: 'crashed' }
    const { deps } = setup({ scanOnce: vi.fn(async () => ({ failed })) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.scanFailed)
  })

  it('fails when the scan does not complete', async () => {
    const { deps } = setup({
      scanOnce: vi.fn(async () => completed(scanDone({ status: 'canceled' }))),
    })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.scanFailed)
  })

  it('fails when the scanner walked into app.asar instead of counting it as a file', async () => {
    const { deps } = setup({
      scanOnce: vi.fn(async () => completed(scanDone(), [row('app.asar', 'folder')])),
    })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.asarEntered)
  })

  it('fails when the walk found no files or no file with a size', async () => {
    const empty = setup({
      scanOnce: vi.fn(async () => completed(scanDone({ files: 0 }), [row('x', 'folder')])),
    })
    expect(await runSelfTest(empty.deps)).toBe(SELF_TEST_EXIT.walkEmpty)

    const zero = setup({
      scanOnce: vi.fn(async () => completed(scanDone(), [row('app.asar.unpacked', 'folder')])),
    })
    expect(await runSelfTest(zero.deps)).toBe(SELF_TEST_EXIT.walkEmpty)
  })

  it('fails a packaged run whose scan used only one walker', async () => {
    const { deps, lines } = setup({
      scanOnce: vi.fn(async () => completed(scanDone({ walkers: 1 }))),
    })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.parallelWalkFailed)
    expect(SELF_TEST_EXIT.parallelWalkFailed).toBe(23)
    expect(lines).toContain('walk: only 1 walker (pool did not start)')
  })

  it('passes a packaged run whose scan used four walkers', async () => {
    const { deps } = setup({ scanOnce: vi.fn(async () => completed(scanDone({ walkers: 4 }))) })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.ok)
  })

  it('does not require the pool when running unpackaged', async () => {
    const { deps } = setup({
      unpackedNativeModule: null,
      scanOnce: vi.fn(async () => completed(scanDone({ walkers: 1 }))),
    })
    expect(await runSelfTest(deps)).toBe(SELF_TEST_EXIT.ok)
  })
})
