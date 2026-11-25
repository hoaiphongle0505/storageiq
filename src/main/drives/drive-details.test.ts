import { describe, expect, it } from 'vitest'
import type { DriveApi } from './drive-api'
import { driveRootOf, isDriveRoot, readDriveDetails } from './drive-details'

function fakeApi(overrides: Partial<DriveApi> = {}): DriveApi {
  return {
    getLogicalDrives: () => 0b100,
    getDriveType: () => 3,
    getVolumeLabel: () => '',
    getVolumeDetails: () => ({ clusterBytes: 4096, fileSystem: 'NTFS' }),
    statfs: async () => ({ bsize: 4096, blocks: 1000, bavail: 250 }),
    ...overrides,
  }
}

describe('driveRootOf and isDriveRoot', () => {
  it.each([
    ['C:\\Users\\Ana', 'C:\\', false],
    ['d:/Photos', 'D:\\', false],
    ['C:\\', 'C:\\', true],
    ['E:', 'E:\\', true],
  ])('%s is on %s (drive root: %s)', (target, root, rootItself) => {
    expect(driveRootOf(target)).toBe(root)
    expect(isDriveRoot(target)).toBe(rootItself)
  })

  it('has no drive for a network path', () => {
    expect(driveRootOf('\\\\server\\share')).toBeNull()
  })
})

describe('readDriveDetails', () => {
  it('combines statfs space with the cluster size and file system', async () => {
    await expect(readDriveDetails(fakeApi(), 'C:\\')).resolves.toEqual({
      root: 'C:\\',
      totalBytes: 4_096_000,
      freeBytes: 1_024_000,
      clusterBytes: 4096,
      fileSystem: 'NTFS',
    })
  })

  it('returns null when the drive cannot be read', async () => {
    const notReady = fakeApi({
      statfs: async () => {
        throw new Error('EBUSY')
      },
    })
    await expect(readDriveDetails(notReady, 'E:\\')).resolves.toBeNull()
    await expect(
      readDriveDetails(fakeApi({ getVolumeDetails: () => null }), 'E:\\'),
    ).resolves.toBeNull()
  })
})
