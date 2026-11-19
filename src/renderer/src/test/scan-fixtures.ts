import type { ScanDone, ScanFailed, ScanProgress } from '@shared/scan-types'

const MB = 1024 ** 2
const GB = 1024 ** 3

export function makeProgress(overrides: Partial<ScanProgress> = {}): ScanProgress {
  return {
    scanId: 'scan-1',
    files: 420,
    folders: 17,
    bytes: 5 * MB,
    currentPath: 'D:\\Photos\\2024\\Summer',
    elapsedMs: 1500,
    topFolders: [
      {
        kind: 'folder',
        name: 'Photos',
        path: 'D:\\Photos',
        bytes: 5 * MB,
        files: 420,
        folders: 17,
      },
    ],
    ...overrides,
  }
}

export function makeDone(overrides: Partial<ScanDone> = {}): ScanDone {
  return {
    scanId: 'scan-1',
    status: 'complete',
    files: 1234,
    folders: 56,
    bytes: 3 * GB,
    elapsedMs: 12_400,
    topFolders: [
      { kind: 'folder', name: 'Videos', path: 'D:\\Videos', bytes: 2 * GB, files: 10, folders: 1 },
      {
        kind: 'folder',
        name: 'Photos',
        path: 'D:\\Photos',
        bytes: 768 * MB,
        files: 1000,
        folders: 50,
      },
      {
        kind: 'everything-else',
        name: 'Everything else',
        path: 'D:\\',
        bytes: 256 * MB,
        files: 224,
        folders: 3,
      },
    ],
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
