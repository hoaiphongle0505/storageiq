import type { ScanDone, ScanFailed, ScanProgress } from '@shared/scan-types'

const MB = 1024 ** 2
const GB = 1024 ** 3

export function makeProgress(overrides: Partial<ScanProgress> = {}): ScanProgress {
  return {
    scanId: 'scan-1',
    files: 420,
    folders: 17,
    bytes: 5 * MB,
    allocatedBytes: 6 * MB,
    currentPath: 'D:\\Photos\\2024\\Summer',
    elapsedMs: 1500,
    errorCount: 0,
    ...overrides,
  }
}

export function makeDone(overrides: Partial<ScanDone> = {}): ScanDone {
  return {
    scanId: 'scan-1',
    status: 'complete',
    files: 1014,
    folders: 53,
    bytes: 3 * GB,
    allocatedBytes: 3 * GB + 8 * MB,
    elapsedMs: 12_400,
    errors: [
      {
        path: 'D:\\System Volume Information',
        kind: 'folder',
        reason: 'access-denied',
        code: 'EPERM',
      },
      {
        path: 'D:\\Old\\Very\\Long\\Path',
        kind: 'folder',
        reason: 'path-too-long',
        code: 'ENAMETOOLONG',
      },
    ],
    errorCount: 2,
    ...overrides,
  }
}

export function makeFailed(overrides: Partial<ScanFailed> = {}): ScanFailed {
  return { scanId: 'scan-1', message: 'The scanner process stopped unexpectedly.', ...overrides }
}
