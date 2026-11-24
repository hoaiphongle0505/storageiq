import { safeExtension, type NativeTarget } from './icon-keys'
import type { RgbaBitmap } from './png'

// Win32 constants (shellapi.h, winuser.h, wingdi.h, fileapi.h, winnt.h).
/** SHGFI_ICON: get the icon handle. */
const SHGFI_ICON = 0x100
/** SHGFI_LARGEICON (0): the system large icon (SM_CXICON, 32 px at 100 %). */
const SHGFI_LARGEICON = 0x0
/** SHGFI_SMALLICON: the system small icon (SM_CXSMICON, 16 px at 100 %). */
const SHGFI_SMALLICON = 0x1
/** SHGFI_USEFILEATTRIBUTES: the path is only a name; the file system is not touched. */
const SHGFI_USEFILEATTRIBUTES = 0x10
/** FILE_ATTRIBUTE_NORMAL, for a file type lookup. */
const FILE_ATTRIBUTE_NORMAL = 0x80
/** FILE_ATTRIBUTE_DIRECTORY, for a folder type lookup. */
const FILE_ATTRIBUTE_DIRECTORY = 0x10
/** GetFileAttributesW's failure value (INVALID_FILE_ATTRIBUTES). */
const INVALID_FILE_ATTRIBUTES = 0xffffffff
/** biCompression BI_RGB and GetDIBits usage DIB_RGB_COLORS. */
const BI_RGB = 0
const DIB_RGB_COLORS = 0
/** COINIT_APARTMENTTHREADED. */
const COINIT_APARTMENTTHREADED = 0x2
/** SHGetKnownFolderPath: KF_FLAG_DEFAULT. */
const KF_FLAG_DEFAULT = 0

/** Folders that have their own icon in Explorer (the user profile is added below). */
const KNOWN_FOLDER_IDS = [
  'B4BFCC3A-DB2C-424C-B029-7FE99A87C641', // FOLDERID_Desktop
  'FDD39AD0-238F-46AF-ADB4-6C85480369C7', // FOLDERID_Documents
  '374DE290-123F-4565-9164-39C4925E467B', // FOLDERID_Downloads
  '33E28130-4E1E-4676-835A-98395C3BC3BB', // FOLDERID_Pictures
  '4BD8D571-6D19-48D3-BE97-422220080E43', // FOLDERID_Music
  '18989B1D-99B5-455B-841C-AB7C74E4DDFC', // FOLDERID_Videos
  '5E6C858F-0E22-4760-9AFE-EA3317B67173', // FOLDERID_Profile (the user profile folder)
] as const

/** The Win32 calls `bitmapFromIcon` needs; tests pass a fake that records every handle. */
export interface IconGdi {
  /** The colour and mask bitmaps of an icon (`GetIconInfo`); null when the call fails. */
  iconInfo(icon: unknown): { hbmColor: unknown; hbmMask: unknown } | null
  /** `GetObjectW` on a bitmap; null when it fails. */
  bitmapSize(bitmap: unknown): { width: number; height: number } | null
  /** `CreateCompatibleDC(NULL)`; null when it fails. */
  createDc(): unknown
  /** `GetDIBits`: BGRA, 32 bpp, top-down, `width * height * 4` bytes; null when it fails. */
  dibits(dc: unknown, bitmap: unknown, width: number, height: number): Uint8Array | null
  deleteObject(handle: unknown): void
  deleteDc(dc: unknown): void
  destroyIcon(icon: unknown): void
}

/**
 * Turns an `HICON` into straight-alpha RGBA pixels, then releases it: `DestroyIcon` on the icon,
 * `DeleteObject` on both bitmaps of `GetIconInfo` and `DeleteDC` on the DC, all in `finally`, on
 * every path including the failure of a later step. A monochrome icon (no colour bitmap) answers
 * `null`. Modern icons carry real alpha; when every alpha byte of the colour bitmap is 0 the
 * alpha comes from the mask bitmap (black = opaque).
 */
export function bitmapFromIcon(gdi: IconGdi, icon: unknown): RgbaBitmap | null {
  let hbmColor: unknown = null
  let hbmMask: unknown = null
  let dc: unknown = null
  try {
    const info = gdi.iconInfo(icon)
    if (info === null) return null
    hbmColor = info.hbmColor
    hbmMask = info.hbmMask
    if (!hbmColor) return null
    const size = gdi.bitmapSize(hbmColor)
    if (size === null || size.width < 1 || size.height < 1) return null
    dc = gdi.createDc()
    if (!dc) return null
    const { width, height } = size
    const pixels = gdi.dibits(dc, hbmColor, width, height)
    if (pixels === null || pixels.length !== width * height * 4) return null
    const data = new Uint8Array(pixels.length)
    let anyAlpha = false
    for (let i = 0; i < pixels.length; i += 4) {
      data[i] = pixels[i + 2] ?? 0 // BGRA to RGBA
      data[i + 1] = pixels[i + 1] ?? 0
      data[i + 2] = pixels[i] ?? 0
      const alpha = pixels[i + 3] ?? 0
      data[i + 3] = alpha
      if (alpha !== 0) anyAlpha = true
    }
    if (!anyAlpha) {
      const mask = hbmMask ? gdi.dibits(dc, hbmMask, width, height) : null
      if (mask === null || mask.length !== data.length) return null
      for (let i = 0; i < data.length; i += 4) {
        const opaque = (mask[i] ?? 0) === 0 && (mask[i + 1] ?? 0) === 0 && (mask[i + 2] ?? 0) === 0
        data[i + 3] = opaque ? 255 : 0
      }
    }
    return { width, height, data }
  } finally {
    if (dc) gdi.deleteDc(dc)
    if (hbmColor) gdi.deleteObject(hbmColor)
    if (hbmMask) gdi.deleteObject(hbmMask)
    gdi.destroyIcon(icon)
  }
}

export interface WinIcons {
  /**
   * The small and large icon of `target`. A `path` target is a real lookup (it can open the
   * file); when Windows has no icon for that path (a missing file) the by-extension icon is
   * returned instead. `null` when Windows has no icon at all.
   */
  fetch(target: NativeTarget): { small: RgbaBitmap; large: RgbaBitmap } | null
  /** `GetFileAttributesW`; null when it fails. */
  attributes(path: string): number | null
  /** Paths of Desktop, Documents, Downloads, Pictures, Music, Videos and the user profile. */
  knownFolders(): string[]
  dispose(): void
}

/**
 * The shell's icons through koffi, for the icon worker thread. Every call is synchronous and
 * must run on a thread that has called `CoInitializeEx(COINIT_APARTMENTTHREADED)`; this function
 * does that for its thread, and `dispose` calls `CoUninitialize`. koffi is imported lazily, like
 * the drive API and the shell menu.
 */
export async function createWinIcons(): Promise<WinIcons> {
  const { default: koffi } = await import('koffi')
  const ole32 = koffi.load('ole32.dll')
  const shell32 = koffi.load('shell32.dll')
  const user32 = koffi.load('user32.dll')
  const gdi32 = koffi.load('gdi32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  // Named types are referenced by name in the declarations below.
  koffi.struct('SIQI_GUID', {
    d1: 'uint32_t',
    d2: 'uint16_t',
    d3: 'uint16_t',
    d4: koffi.array('uint8_t', 8),
  })
  const SHFILEINFOW = koffi.struct('SIQI_SHFILEINFOW', {
    hIcon: 'void *',
    iIcon: 'int32_t',
    dwAttributes: 'uint32_t',
    szDisplayName: koffi.array('uint16_t', 260),
    szTypeName: koffi.array('uint16_t', 80),
  })
  koffi.struct('SIQI_ICONINFO', {
    fIcon: 'int32_t',
    xHotspot: 'uint32_t',
    yHotspot: 'uint32_t',
    hbmMask: 'void *',
    hbmColor: 'void *',
  })
  const BITMAP = koffi.struct('SIQI_BITMAP', {
    bmType: 'int32_t',
    bmWidth: 'int32_t',
    bmHeight: 'int32_t',
    bmWidthBytes: 'int32_t',
    bmPlanes: 'uint16_t',
    bmBitsPixel: 'uint16_t',
    bmBits: 'void *',
  })
  koffi.struct('SIQI_BITMAPINFOHEADER', {
    biSize: 'uint32_t',
    biWidth: 'int32_t',
    biHeight: 'int32_t',
    biPlanes: 'uint16_t',
    biBitCount: 'uint16_t',
    biCompression: 'uint32_t',
    biSizeImage: 'uint32_t',
    biXPelsPerMeter: 'int32_t',
    biYPelsPerMeter: 'int32_t',
    biClrUsed: 'uint32_t',
    biClrImportant: 'uint32_t',
  })

  const CoInitializeEx = ole32.func('int __stdcall CoInitializeEx(void *reserved, uint32_t coinit)')
  const CoUninitialize = ole32.func('void __stdcall CoUninitialize()')
  const CoTaskMemFree = ole32.func('void __stdcall CoTaskMemFree(void *pv)')
  const SHGetFileInfoW = shell32.func(
    'uintptr_t __stdcall SHGetFileInfoW(const char16_t *path, uint32_t attrs, _Out_ SIQI_SHFILEINFOW *info, uint32_t size, uint32_t flags)',
  )
  const SHGetKnownFolderPath = shell32.func(
    'int __stdcall SHGetKnownFolderPath(SIQI_GUID *id, uint32_t flags, void *token, _Out_ void **path)',
  )
  const GetIconInfo = user32.func(
    'int __stdcall GetIconInfo(void *icon, _Out_ SIQI_ICONINFO *info)',
  )
  const DestroyIcon = user32.func('int __stdcall DestroyIcon(void *icon)')
  const GetObjectW = gdi32.func(
    'int __stdcall GetObjectW(void *handle, int size, _Out_ SIQI_BITMAP *object)',
  )
  const CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void *dc)')
  const DeleteDC = gdi32.func('int __stdcall DeleteDC(void *dc)')
  const DeleteObject = gdi32.func('int __stdcall DeleteObject(void *object)')
  const GetDIBits = gdi32.func(
    'int __stdcall GetDIBits(void *dc, void *bitmap, uint32_t start, uint32_t lines, _Out_ uint8_t *bits, SIQI_BITMAPINFOHEADER *info, uint32_t usage)',
  )
  const GetFileAttributesW = kernel32.func(
    'uint32_t __stdcall GetFileAttributesW(const char16_t *path)',
  )

  // This thread is its own apartment (the worker is dedicated to icons). If it already had a
  // different one, RPC_E_CHANGED_MODE is returned and the existing apartment is used as is.
  CoInitializeEx(null, COINIT_APARTMENTTHREADED)

  const guid = (text: string) => {
    const hex = text.replace(/[{}-]/g, '')
    const tail: number[] = []
    for (let i = 16; i < 32; i += 2) tail.push(parseInt(hex.slice(i, i + 2), 16))
    return {
      d1: parseInt(hex.slice(0, 8), 16),
      d2: parseInt(hex.slice(8, 12), 16),
      d3: parseInt(hex.slice(12, 16), 16),
      d4: tail,
    }
  }

  const gdi: IconGdi = {
    iconInfo: (icon) => {
      const info: { hbmColor?: unknown; hbmMask?: unknown } = {}
      if (!GetIconInfo(icon, info)) return null
      return { hbmColor: info.hbmColor ?? null, hbmMask: info.hbmMask ?? null }
    },
    bitmapSize: (bitmap) => {
      const object: { bmWidth?: number; bmHeight?: number } = {}
      if (!GetObjectW(bitmap, koffi.sizeof(BITMAP), object)) return null
      return { width: object.bmWidth ?? 0, height: object.bmHeight ?? 0 }
    },
    createDc: () => CreateCompatibleDC(null) as unknown,
    dibits: (dc, bitmap, width, height) => {
      const bits = new Uint8Array(width * height * 4)
      const header = {
        biSize: 40,
        biWidth: width,
        biHeight: -height, // negative: top-down
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB,
        biSizeImage: 0,
        biXPelsPerMeter: 0,
        biYPelsPerMeter: 0,
        biClrUsed: 0,
        biClrImportant: 0,
      }
      const lines = Number(GetDIBits(dc, bitmap, 0, height, bits, header, DIB_RGB_COLORS))
      return lines === height ? bits : null
    },
    deleteObject: (handle) => {
      DeleteObject(handle)
    },
    deleteDc: (dc) => {
      DeleteDC(dc)
    },
    destroyIcon: (icon) => {
      if (icon) DestroyIcon(icon)
    },
  }

  /** One `SHGetFileInfoW` icon of `path` at the `size` flag; null when Windows has none. */
  const iconOf = (
    path: string,
    attributes: number,
    flags: number,
    size: number,
  ): RgbaBitmap | null => {
    const info: { hIcon?: unknown } = {}
    const result = SHGetFileInfoW(path, attributes, info, koffi.sizeof(SHFILEINFOW), flags | size)
    // A returned icon must be destroyed even when the conversion fails: bitmapFromIcon does it.
    if (!info.hIcon) return null
    if (!result) {
      // Windows reported no icon but set a handle: never leak it.
      DestroyIcon(info.hIcon)
      return null
    }
    return bitmapFromIcon(gdi, info.hIcon)
  }

  const pair = (
    path: string,
    attributes: number,
    flags: number,
  ): { small: RgbaBitmap; large: RgbaBitmap } | null => {
    const small = iconOf(path, attributes, flags | SHGFI_ICON, SHGFI_SMALLICON)
    if (small === null) return null
    const large = iconOf(path, attributes, flags | SHGFI_ICON, SHGFI_LARGEICON)
    return large === null ? null : { small, large }
  }

  /** A made-up name: Windows answers from the registered type, without touching the disk. */
  const byType = (target: Exclude<NativeTarget, { kind: 'path' }>) =>
    target.kind === 'dir'
      ? pair('folder', FILE_ATTRIBUTE_DIRECTORY, SHGFI_USEFILEATTRIBUTES)
      : pair(
          target.ext === '' ? 'file' : `x.${target.ext}`,
          FILE_ATTRIBUTE_NORMAL,
          SHGFI_USEFILEATTRIBUTES,
        )

  let disposed = false
  return {
    fetch(target) {
      if (target.kind !== 'path') return byType(target)
      const real = pair(target.path, 0, 0)
      if (real !== null) return real
      // Missing file, unreadable, or no icon: the by-extension icon instead.
      const ext = safeExtension(target.path.slice(target.path.lastIndexOf('\\') + 1))
      return byType({ kind: 'file', ext })
    },
    attributes(path) {
      const attributes = Number(GetFileAttributesW(path))
      return attributes === INVALID_FILE_ATTRIBUTES ? null : attributes
    },
    knownFolders() {
      const paths: string[] = []
      for (const id of KNOWN_FOLDER_IDS) {
        const out: unknown[] = [null]
        const hr = Number(SHGetKnownFolderPath(guid(id), KF_FLAG_DEFAULT, null, out))
        if (hr < 0 || !out[0]) continue
        try {
          paths.push(String(koffi.decode(out[0], 'char16_t', -1)))
        } finally {
          CoTaskMemFree(out[0])
        }
      }
      return paths
    },
    dispose() {
      if (disposed) return
      disposed = true
      try {
        CoUninitialize()
      } catch {
        // the thread is going away anyway
      }
    },
  }
}
