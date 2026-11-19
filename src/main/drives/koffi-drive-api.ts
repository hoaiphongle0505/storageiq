import { statfs } from 'node:fs/promises'
import type { DriveApi } from './drive-api'

/** MAX_PATH + 1 UTF-16 code units: the documented size for a volume-name buffer. */
const LABEL_BUFFER_CHARS = 261

/**
 * Binds GetLogicalDrives, GetDriveTypeW and GetVolumeInformationW from kernel32 with koffi.
 * koffi is imported lazily, so a broken native module fails `drives:list`, not app startup.
 * `__stdcall` is the WINAPI convention; koffi ignores it on x64.
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
      'void *lpFileSystemNameBuffer, uint32_t nFileSystemNameSize)',
  )

  return {
    getLogicalDrives: () => Number(getLogicalDrives()),
    getDriveType: (root) => Number(getDriveTypeW(root)),
    getVolumeLabel: (root) => {
      const buffer = Buffer.alloc(LABEL_BUFFER_CHARS * 2)
      const ok = Number(
        getVolumeInformationW(root, buffer, LABEL_BUFFER_CHARS, null, null, null, null, 0),
      )
      if (ok === 0) return null
      const text = buffer.toString('utf16le')
      const end = text.indexOf('\0')
      return end === -1 ? text : text.slice(0, end)
    },
    statfs: (root) => statfs(root),
  }
}
