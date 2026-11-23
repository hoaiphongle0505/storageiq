import type { BuiltShellMenu, ShellMenuNative } from './context-menu'
import {
  SHELL_FIRST_ID,
  SHELL_LAST_ID,
  STORAGEIQ_COMMAND_IDS,
  STORAGEIQ_MENU_LABELS,
} from './menu-commands'

/** A shell call that returned a failing HRESULT; `hresult` is the unsigned 32-bit value. */
export class ShellMenuError extends Error {
  readonly hresult: number
  readonly step: string

  constructor(step: string, hresult: number) {
    const unsigned = hresult >>> 0
    super(`${step} failed (0x${unsigned.toString(16)})`)
    this.name = 'ShellMenuError'
    this.step = step
    this.hresult = unsigned
  }
}

/** ERROR_FILE_NOT_FOUND and ERROR_PATH_NOT_FOUND as HRESULTs: the item no longer exists. */
export const SHELL_PATH_GONE_HRESULTS: readonly number[] = [0x80070002, 0x80070003]

export function isShellPathGone(error: unknown): boolean {
  return error instanceof ShellMenuError && SHELL_PATH_GONE_HRESULTS.includes(error.hresult)
}

// Win32 and COM constants (shobjidl_core.h, winuser.h, objbase.h).
const COINIT_APARTMENTTHREADED = 0x2
const S_OK = 0
const MF_STRING = 0x0
const MF_POPUP = 0x10
const MF_SEPARATOR = 0x800
const MF_BYPOSITION = 0x400
const CMF_NORMAL = 0x0
const CMF_EXPLORE = 0x4
const CMF_EXTENDEDVERBS = 0x100
const TPM_RIGHTBUTTON = 0x2
const TPM_RETURNCMD = 0x100
const GCS_VERBW = 0x4
const CMIC_MASK_UNICODE = 0x4000
const CMIC_MASK_SHIFT_DOWN = 0x10000000
const CMIC_MASK_CONTROL_DOWN = 0x40000000
const VK_SHIFT = 0x10
const VK_CONTROL = 0x11
const CMIC_MASK_PTINVOKE = 0x20000000
const SW_SHOWNORMAL = 1
const WM_DRAWITEM = 0x2b
const WM_MEASUREITEM = 0x2c
const WM_INITMENUPOPUP = 0x117
const WM_MENUCHAR = 0x120
const MENU_MESSAGES = new Set([WM_DRAWITEM, WM_MEASUREITEM, WM_INITMENUPOPUP, WM_MENUCHAR])
/** Our subclass id on the window (any constant unique to StorageIQ). */
const SUBCLASS_ID = 0x5149

const IID_IShellFolder = '000214E6-0000-0000-C000-000000000046'
const IID_IContextMenu = '000214E4-0000-0000-C000-000000000046'
const IID_IContextMenu2 = '000214F4-0000-0000-C000-000000000046'
const IID_IContextMenu3 = 'BCFCE0A0-EC17-11D0-8D10-00A0C90F2719'

// vtable slots (IUnknown 0-2, then the interface's own methods in declaration order).
const VT_RELEASE = 2
const VT_QUERY_INTERFACE = 0
const VT_SHELLFOLDER_GET_UI_OBJECT_OF = 10
const VT_CONTEXTMENU_QUERY_CONTEXT_MENU = 3
const VT_CONTEXTMENU_INVOKE_COMMAND = 4
const VT_CONTEXTMENU_GET_COMMAND_STRING = 5
const VT_CONTEXTMENU2_HANDLE_MENU_MSG = 6
const VT_CONTEXTMENU3_HANDLE_MENU_MSG2 = 7

interface Guid {
  d1: number
  d2: number
  d3: number
  d4: number[]
}

export function guid(text: string): Guid {
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

const failed = (hr: number) => hr < 0

/**
 * The real Explorer context menu through koffi: SHParseDisplayName + SHBindToParent give the
 * parent IShellFolder and the item's child id; GetUIObjectOf gives IContextMenu (plus
 * IContextMenu2/3 for "Send to", "Open with" and other submenus that fill themselves in or draw
 * their own items). The menu is shown with TrackPopupMenuEx(TPM_RETURNCMD) on the app window
 * while a temporary window subclass forwards the menu messages to HandleMenuMsg(2), and the
 * choice runs through InvokeCommand. koffi is imported lazily, like the drive API.
 */
export async function createWinShellMenu(): Promise<ShellMenuNative> {
  const { default: koffi } = await import('koffi')
  const ole32 = koffi.load('ole32.dll')
  const shell32 = koffi.load('shell32.dll')
  const user32 = koffi.load('user32.dll')
  const comctl32 = koffi.load('comctl32.dll')

  // Named types are referenced by name in the declarations below.
  koffi.struct('SIQ_GUID', {
    d1: 'uint32_t',
    d2: 'uint16_t',
    d3: 'uint16_t',
    d4: koffi.array('uint8_t', 8),
  })
  const POINT = koffi.struct('SIQ_POINT', { x: 'int32_t', y: 'int32_t' })
  const CMINVOKECOMMANDINFOEX = koffi.struct('SIQ_CMINVOKECOMMANDINFOEX', {
    cbSize: 'uint32_t',
    fMask: 'uint32_t',
    hwnd: 'void *',
    lpVerb: 'void *',
    lpParameters: 'void *',
    lpDirectory: 'void *',
    nShow: 'int32_t',
    dwHotKey: 'uint32_t',
    hIcon: 'void *',
    lpTitle: 'void *',
    lpVerbW: 'void *',
    lpParametersW: 'void *',
    lpDirectoryW: 'void *',
    lpTitleW: 'void *',
    ptInvoke: POINT,
  })

  const CoInitializeEx = ole32.func('int __stdcall CoInitializeEx(void *reserved, uint32_t coinit)')
  const CoTaskMemFree = ole32.func('void __stdcall CoTaskMemFree(void *pv)')
  const SHParseDisplayName = shell32.func(
    'int __stdcall SHParseDisplayName(const char16_t *name, void *bindCtx, _Out_ void **pidl, uint32_t sfgaoIn, void *sfgaoOut)',
  )
  const SHBindToParent = shell32.func(
    'int __stdcall SHBindToParent(void *pidl, SIQ_GUID *riid, _Out_ void **ppv, _Out_ void **childPidl)',
  )
  const CreatePopupMenu = user32.func('void * __stdcall CreatePopupMenu()')
  const DestroyMenu = user32.func('int __stdcall DestroyMenu(void *menu)')
  const AppendMenuW = user32.func(
    'int __stdcall AppendMenuW(void *menu, uint32_t flags, uintptr_t idOrSubmenu, const char16_t *text)',
  )
  const GetMenuItemCount = user32.func('int __stdcall GetMenuItemCount(void *menu)')
  const GetMenuStringW = user32.func(
    'int __stdcall GetMenuStringW(void *menu, uint32_t item, _Out_ uint16_t *text, int max, uint32_t flags)',
  )
  const GetKeyState = user32.func('int16_t __stdcall GetKeyState(int vk)')
  const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hwnd)')
  const TrackPopupMenuEx = user32.func(
    'int __stdcall TrackPopupMenuEx(void *menu, uint32_t flags, int x, int y, void *hwnd, void *params)',
  )
  const SubclassProc = koffi.proto(
    'intptr_t __stdcall SIQ_SubclassProc(void *hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uintptr_t id, uintptr_t refData)',
  )
  const SetWindowSubclass = comctl32.func(
    'int __stdcall SetWindowSubclass(void *hwnd, SIQ_SubclassProc *proc, uintptr_t id, uintptr_t refData)',
  )
  const RemoveWindowSubclass = comctl32.func(
    'int __stdcall RemoveWindowSubclass(void *hwnd, SIQ_SubclassProc *proc, uintptr_t id)',
  )
  const DefSubclassProc = comctl32.func(
    'intptr_t __stdcall DefSubclassProc(void *hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam)',
  )

  const Release = koffi.proto('uint32_t __stdcall SIQ_Release(void *self)')
  const QueryInterface = koffi.proto(
    'int __stdcall SIQ_QueryInterface(void *self, SIQ_GUID *riid, _Out_ void **ppv)',
  )
  const GetUIObjectOf = koffi.proto(
    'int __stdcall SIQ_GetUIObjectOf(void *self, void *hwnd, uint32_t count, void **children, SIQ_GUID *riid, void *reserved, _Out_ void **ppv)',
  )
  const QueryContextMenu = koffi.proto(
    'int __stdcall SIQ_QueryContextMenu(void *self, void *menu, uint32_t index, uint32_t first, uint32_t last, uint32_t flags)',
  )
  const InvokeCommand = koffi.proto(
    'int __stdcall SIQ_InvokeCommand(void *self, SIQ_CMINVOKECOMMANDINFOEX *info)',
  )
  const GetCommandString = koffi.proto(
    'int __stdcall SIQ_GetCommandString(void *self, uintptr_t id, uint32_t type, void *reserved, _Out_ uint16_t *name, uint32_t max)',
  )
  const HandleMenuMsg = koffi.proto(
    'int __stdcall SIQ_HandleMenuMsg(void *self, uint32_t msg, uintptr_t wParam, intptr_t lParam)',
  )
  const HandleMenuMsg2 = koffi.proto(
    'int __stdcall SIQ_HandleMenuMsg2(void *self, uint32_t msg, uintptr_t wParam, intptr_t lParam, _Out_ intptr_t *result)',
  )

  // The Electron main thread already runs a COM apartment (S_FALSE); if it is a different one,
  // RPC_E_CHANGED_MODE is returned and the existing apartment is used as is.
  CoInitializeEx(null, COINIT_APARTMENTTHREADED)

  /** Reads entry `slot` of a COM object's vtable. */
  const method = (object: unknown, slot: number): unknown =>
    koffi.decode(koffi.decode(object, 'void *'), slot * 8, 'void *')
  const release = (object: unknown) => {
    if (object) koffi.call(method(object, VT_RELEASE), Release, object)
  }
  const queryInterface = (object: unknown, iid: string): unknown => {
    const out: unknown[] = [null]
    const hr = Number(
      koffi.call(method(object, VT_QUERY_INTERFACE), QueryInterface, object, guid(iid), out),
    )
    return failed(hr) ? null : out[0]
  }

  const labelsOf = (menu: unknown): string[] => {
    const count = Number(GetMenuItemCount(menu))
    const labels: string[] = []
    for (let i = 0; i < count; i += 1) {
      const buffer = new Uint16Array(512)
      const length = Number(GetMenuStringW(menu, i, buffer, buffer.length, MF_BYPOSITION))
      labels.push(String.fromCharCode(...buffer.subarray(0, Math.max(0, length))))
    }
    return labels
  }

  return {
    build(hwnd, path, extended): BuiltShellMenu {
      const pidl: unknown[] = [null]
      let hr = Number(SHParseDisplayName(path, null, pidl, 0, null))
      if (failed(hr) || !pidl[0]) throw new ShellMenuError('SHParseDisplayName', hr >>> 0)
      const folder: unknown[] = [null]
      const child: unknown[] = [null]
      let contextMenu: unknown = null
      let menu2: unknown = null
      let menu3: unknown = null
      let menu: unknown = null
      let submenu: unknown = null
      try {
        hr = Number(SHBindToParent(pidl[0], guid(IID_IShellFolder), folder, child))
        if (failed(hr)) throw new ShellMenuError('SHBindToParent', hr >>> 0)
        const out: unknown[] = [null]
        hr = Number(
          koffi.call(
            method(folder[0], VT_SHELLFOLDER_GET_UI_OBJECT_OF),
            GetUIObjectOf,
            folder[0],
            hwnd,
            1,
            [child[0]],
            guid(IID_IContextMenu),
            null,
            out,
          ),
        )
        if (failed(hr)) throw new ShellMenuError('GetUIObjectOf', hr >>> 0)
        contextMenu = out[0]
        menu3 = queryInterface(contextMenu, IID_IContextMenu3)
        menu2 = menu3 === null ? queryInterface(contextMenu, IID_IContextMenu2) : null

        menu = CreatePopupMenu()
        if (!menu) throw new Error('CreatePopupMenu failed')
        submenu = CreatePopupMenu()
        if (!submenu) throw new Error('CreatePopupMenu failed')
        AppendMenuW(
          submenu,
          MF_STRING,
          STORAGEIQ_COMMAND_IDS.refresh,
          STORAGEIQ_MENU_LABELS.refresh,
        )
        AppendMenuW(
          submenu,
          MF_STRING,
          STORAGEIQ_COMMAND_IDS['copy-path'],
          STORAGEIQ_MENU_LABELS['copy-path'],
        )
        AppendMenuW(submenu, MF_STRING, STORAGEIQ_COMMAND_IDS.open, STORAGEIQ_MENU_LABELS.open)
        if (!AppendMenuW(menu, MF_POPUP, submenu, STORAGEIQ_MENU_LABELS.submenu))
          throw new Error('AppendMenuW failed')
        submenu = null // owned by `menu` now; DestroyMenu(menu) destroys it
        AppendMenuW(
          menu,
          MF_STRING,
          STORAGEIQ_COMMAND_IDS['new-folder'],
          STORAGEIQ_MENU_LABELS['new-folder'],
        )
        AppendMenuW(menu, MF_SEPARATOR, 0, null)
        const flags = CMF_NORMAL | CMF_EXPLORE | (extended ? CMF_EXTENDEDVERBS : 0)
        hr = Number(
          koffi.call(
            method(contextMenu, VT_CONTEXTMENU_QUERY_CONTEXT_MENU),
            QueryContextMenu,
            contextMenu,
            menu,
            Number(GetMenuItemCount(menu)),
            SHELL_FIRST_ID,
            SHELL_LAST_ID,
            flags,
          ),
        )
        if (failed(hr)) throw new ShellMenuError('QueryContextMenu', hr >>> 0)
      } catch (error) {
        if (menu) DestroyMenu(menu)
        if (submenu) DestroyMenu(submenu)
        release(menu3)
        release(menu2)
        release(contextMenu)
        release(folder[0])
        CoTaskMemFree(pidl[0])
        throw error
      }

      const builtMenu = menu
      const forwardMenuMessage = (
        window: unknown,
        msg: number,
        wParam: unknown,
        lParam: unknown,
      ): unknown => {
        // A JS exception must never cross the native window-procedure frame.
        try {
          if (MENU_MESSAGES.has(msg)) {
            if (menu3) {
              const result: unknown[] = [0]
              const handled = Number(
                koffi.call(
                  method(menu3, VT_CONTEXTMENU3_HANDLE_MENU_MSG2),
                  HandleMenuMsg2,
                  menu3,
                  msg,
                  wParam,
                  lParam,
                  result,
                ),
              )
              if (handled === S_OK) return result[0] ?? 0
            } else if (menu2) {
              const handled = Number(
                koffi.call(
                  method(menu2, VT_CONTEXTMENU2_HANDLE_MENU_MSG),
                  HandleMenuMsg,
                  menu2,
                  msg,
                  wParam,
                  lParam,
                ),
              )
              if (handled === S_OK) return 0
            }
          }
        } catch {
          // fall through to the default handling
        }
        return DefSubclassProc(window, msg, wParam, lParam)
      }

      return {
        labels: () => labelsOf(builtMenu),

        track(x, y) {
          const proc = koffi.register(forwardMenuMessage, koffi.pointer(SubclassProc))
          let subclassed = false
          try {
            subclassed = Boolean(SetWindowSubclass(hwnd, proc, SUBCLASS_ID, 0))
            if (!subclassed) throw new Error('SetWindowSubclass failed')
            // TrackPopupMenuEx needs its owner in the foreground, or the menu does not close
            // when the user clicks elsewhere (TrackPopupMenu remarks).
            SetForegroundWindow(hwnd)
            return Number(
              TrackPopupMenuEx(builtMenu, TPM_RETURNCMD | TPM_RIGHTBUTTON, x, y, hwnd, null),
            )
          } finally {
            if (subclassed) RemoveWindowSubclass(hwnd, proc, SUBCLASS_ID)
            koffi.unregister(proc)
          }
        },

        verb(offset) {
          const buffer = new Uint16Array(256)
          const result = Number(
            koffi.call(
              method(contextMenu, VT_CONTEXTMENU_GET_COMMAND_STRING),
              GetCommandString,
              contextMenu,
              offset,
              GCS_VERBW,
              null,
              buffer,
              buffer.length,
            ),
          )
          if (failed(result)) return null
          const end = buffer.indexOf(0)
          const verb = String.fromCharCode(...buffer.subarray(0, end === -1 ? buffer.length : end))
          return verb === '' ? null : verb
        },

        invoke(offset, x, y) {
          // Explorer reads the live key state: Shift may have been released since the right-click.
          const shiftDown = Number(GetKeyState(VK_SHIFT)) < 0
          const controlDown = Number(GetKeyState(VK_CONTROL)) < 0
          const info = {
            cbSize: koffi.sizeof(CMINVOKECOMMANDINFOEX),
            fMask:
              CMIC_MASK_UNICODE |
              CMIC_MASK_PTINVOKE |
              (shiftDown ? CMIC_MASK_SHIFT_DOWN : 0) |
              (controlDown ? CMIC_MASK_CONTROL_DOWN : 0),
            hwnd,
            // MAKEINTRESOURCE(offset): the item is named by its offset from SHELL_FIRST_ID.
            lpVerb: BigInt(offset),
            lpParameters: null,
            lpDirectory: null,
            nShow: SW_SHOWNORMAL,
            dwHotKey: 0,
            hIcon: null,
            lpTitle: null,
            lpVerbW: BigInt(offset),
            lpParametersW: null,
            lpDirectoryW: null,
            lpTitleW: null,
            ptInvoke: { x, y },
          }
          const hr = Number(
            koffi.call(
              method(contextMenu, VT_CONTEXTMENU_INVOKE_COMMAND),
              InvokeCommand,
              contextMenu,
              info,
            ),
          )
          if (failed(hr)) throw new ShellMenuError('InvokeCommand', hr >>> 0)
        },

        release() {
          DestroyMenu(builtMenu)
          release(menu3)
          release(menu2)
          release(contextMenu)
          release(folder[0])
          CoTaskMemFree(pidl[0])
        },
      }
    },
  }
}
