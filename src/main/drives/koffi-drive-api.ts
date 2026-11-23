import { statfs } from 'node:fs/promises'
import type { DriveApi } from './drive-api'

/** MAX_PATH + 1 UTF-16 code units: the documented size for a volume-name buffer. */
const NAME_BUFFER_CHARS = 261

function readUtf16(buffer: Buffer): string {
  const text = buffer.toString('utf16le')
  const end = text.indexOf('\0')
  return end === -1 ? text : text.slice(0, end)
}

/**
 * Binds GetLogicalDrives, GetDriveTypeW, GetVolumeInformationW and GetDiskFreeSpaceW from
 * kernel32 with koffi. koffi is imported lazily, so a broken native module fails the drive
 * calls, not app startup. `__stdcall` is the WINAPI convention; koffi ignores it on x64.
 */
export async function createKoffiDriveApi(): Promise<DriveApi> {
  const { default: koffi } = await import('koffi')
  const kernel32 = koffi.load('kernel32.dll')
  const getLogicalDrives = kernel32.func('uint32_t __stdcall GetLogicalDrives()')
  const getDriveTypeW = kernel32.func(
    'uint32_t __stdcall GetDriveTypeW(const char16_t *lpRootPathName)',
  )
  const getVolumeInformationW = kernel32.func(
    'int __stdcall GetVolumeInformationW(const char16_t *lpRootPathName, ' +
      '_Out_ uint16_t *lpVolumeNameBuffer, uint32_t nVolumeNameSize, ' +
      'void *lpVolumeSerialNumber, void *lpMaximumComponentLength, void *lpFileSystemFlags, ' +
      '_Out_ uint16_t *lpFileSystemNameBuffer, uint32_t nFileSystemNameSize)',
  )
  const getDiskFreeSpaceW = kernel32.func(
    'int __stdcall GetDiskFreeSpaceW(const char16_t *lpRootPathName, ' +
      '_Out_ uint32_t *lpSectorsPerCluster, _Out_ uint32_t *lpBytesPerSector, ' +
      '_Out_ uint32_t *lpNumberOfFreeClusters, _Out_ uint32_t *lpTotalNumberOfClusters)',
  )

  return {
    getLogicalDrives: () => Number(getLogicalDrives()),
    getDriveType: (root) => Number(getDriveTypeW(root)),
    getVolumeLabel: (root) => {
      const buffer = Buffer.alloc(NAME_BUFFER_CHARS * 2)
      const ok = Number(
        getVolumeInformationW(root, buffer, NAME_BUFFER_CHARS, null, null, null, null, 0),
      )
      return ok === 0 ? null : readUtf16(buffer)
    },
    getVolumeDetails: (root) => {
      const sectorsPerCluster = [0]
      const bytesPerSector = [0]
      const ok = Number(getDiskFreeSpaceW(root, sectorsPerCluster, bytesPerSector, [0], [0]))
      if (ok === 0) return null
      const fileSystem = Buffer.alloc(NAME_BUFFER_CHARS * 2)
      const named = Number(
        getVolumeInformationW(root, null, 0, null, null, null, fileSystem, NAME_BUFFER_CHARS),
      )
      return {
        clusterBytes: (sectorsPerCluster[0] ?? 0) * (bytesPerSector[0] ?? 0),
        fileSystem: named === 0 ? '' : readUtf16(fileSystem),
      }
    },
    statfs: (root) => statfs(root),
  }
}
