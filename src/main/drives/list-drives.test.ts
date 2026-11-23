import { describe, expect, it, vi } from 'vitest'
import { DRIVE_FIXED, DRIVE_REMOVABLE, type DriveApi, type DriveSpace } from './drive-api'
import { driveRoots, listDrives } from './list-drives'

const DRIVE_REMOTE = 4
const DRIVE_CDROM = 5
const DRIVE_RAMDISK = 6
const GB = 1024 ** 3
const DEFAULT_SPACE: DriveSpace = {
  bsize: 4096,
  blocks: (100 * GB) / 4096,
  bavail: (40 * GB) / 4096,
}

interface FakeDrive {
  type: number
  label?: string | null
  space?: DriveSpace | 'unreadable'
}

function fakeApi(drives: Record<string, FakeDrive>) {
  const mask = Object.keys(drives).reduce(
    (bits, root) => bits | (1 << (root.charCodeAt(0) - 65)),
    0,
  )
  const statfs = vi.fn(async (root: string): Promise<DriveSpace> => {
    const space = drives[root]?.space ?? DEFAULT_SPACE
    if (space === 'unreadable') throw Object.assign(new Error('not ready'), { code: 'EBUSY' })
    return space
  })
  const api: DriveApi = {
    getLogicalDrives: () => mask,
    getDriveType: (root) => drives[root]?.type ?? 0,
    getVolumeLabel: (root) => {
      const label = drives[root]?.label
      return label === undefined ? '' : label
    },
    getVolumeDetails: () => ({ clusterBytes: 4096, fileSystem: 'NTFS' }),
    statfs,
  }
  return { api, statfs }
}

describe('driveRoots', () => {
  it('turns the GetLogicalDrives bit mask into drive roots', () => {
    expect(driveRoots(0b101)).toEqual(['A:\\', 'C:\\'])
    expect(driveRoots((1 << 2) | (1 << 25))).toEqual(['C:\\', 'Z:\\'])
    expect(driveRoots(0)).toEqual([])
  })
})

describe('listDrives', () => {
  it('keeps only fixed and removable drives', async () => {
    const { api } = fakeApi({
      'C:\\': { type: DRIVE_FIXED },
      'D:\\': { type: DRIVE_CDROM },
      'E:\\': { type: DRIVE_REMOVABLE },
      'F:\\': { type: DRIVE_REMOTE },
      'R:\\': { type: DRIVE_RAMDISK },
    })
    const drives = await listDrives(api)
    expect(drives.map((drive) => [drive.root, drive.kind])).toEqual([
      ['C:\\', 'fixed'],
      ['E:\\', 'removable'],
    ])
  })

  it('computes total and free bytes from statfs', async () => {
    const { api } = fakeApi({
      'C:\\': {
        type: DRIVE_FIXED,
        label: 'System',
        space: { bsize: 4096, blocks: 1000, bavail: 250 },
      },
    })
    expect(await listDrives(api)).toEqual([
      { root: 'C:\\', label: 'System', kind: 'fixed', totalBytes: 4_096_000, freeBytes: 1_024_000 },
    ])
  })

  it('falls back to Windows’ default names when a volume has no label', async () => {
    const { api } = fakeApi({
      'C:\\': { type: DRIVE_FIXED, label: '' },
      'D:\\': { type: DRIVE_FIXED, label: '  Data  ' },
      'E:\\': { type: DRIVE_REMOVABLE, label: null },
    })
    const drives = await listDrives(api)
    expect(drives.map((drive) => drive.label)).toEqual(['Local Disk', 'Data', 'USB Drive'])
  })

  it('leaves out a drive whose free space cannot be read', async () => {
    const { api } = fakeApi({
      'C:\\': { type: DRIVE_FIXED },
      'E:\\': { type: DRIVE_REMOVABLE, space: 'unreadable' },
    })
    expect((await listDrives(api)).map((drive) => drive.root)).toEqual(['C:\\'])
  })

  it('never asks for the size of a drive type it drops', async () => {
    const { api, statfs } = fakeApi({
      'C:\\': { type: DRIVE_FIXED },
      'F:\\': { type: DRIVE_REMOTE },
    })
    await listDrives(api)
    expect(statfs).toHaveBeenCalledTimes(1)
    expect(statfs).toHaveBeenCalledWith('C:\\')
  })
})
