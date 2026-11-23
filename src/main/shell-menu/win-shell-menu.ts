import { chooseRoute, hideDestructiveVerbs, type MenuRoute } from './context-menu'
import {
  SHELL_FIRST_ID,
  SHELL_LAST_ID,
  STORAGEIQ_COMMAND_IDS,
  STORAGEIQ_MENU_LABELS,
  storageiqMenuLabels,
} from './menu-commands'
import { E_FAIL, HRESULT_CANCELLED, ShellMenuError } from './shell-menu-error'
import type { BuildOptions, BuiltShellMenu, ShellNative } from './shell-native'

export { isShellPathGone, SHELL_PATH_GONE_HRESULTS, ShellMenuError } from './shell-menu-error'

// Win32 and COM constants (shobjidl_core.h, winuser.h, objbase.h).
const COINIT_APARTMENTTHREADED = 0x2
const CLSCTX_INPROC_SERVER = 0x1
const CLSCTX_LOCAL_SERVER = 0x4
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
// IFileOperation flags: FOF_ALLOWUNDO | FOFX_ADDUNDORECORD | FOFX_RECYCLEONDELETE. The Recycle
// Bin flag is always set; StorageIQ has no permanent-delete path.
const FOF_ALLOWUNDO = 0x40
const FOFX_ADDUNDORECORD = 0x20000000
const FOFX_RECYCLEONDELETE = 0x00080000

const IID_IShellFolder = '000214E6-0000-0000-C000-000000000046'
const IID_IContextMenu = '000214E4-0000-0000-C000-000000000046'
const IID_IContextMenu2 = '000214F4-0000-0000-C000-000000000046'
const IID_IContextMenu3 = 'BCFCE0A0-EC17-11D0-8D10-00A0C90F2719'
const IID_IFileOperation = '947AAB5F-0A5C-4C13-B4D6-4BF7836FC9F8'
const CLSID_FileOperation = '3AD05575-8857-4850-9277-11B85BDB8E09'

// vtable slots (IUnknown 0-2, then the interface's own methods in declaration order).
const VT_RELEASE = 2
const VT_QUERY_INTERFACE = 0
const VT_SHELLFOLDER_GET_UI_OBJECT_OF = 10
const VT_CONTEXTMENU_QUERY_CONTEXT_MENU = 3
const VT_CONTEXTMENU_INVOKE_COMMAND = 4
const VT_CONTEXTMENU_GET_COMMAND_STRING = 5
const VT_CONTEXTMENU2_HANDLE_MENU_MSG = 6
const VT_CONTEXTMENU3_HANDLE_MENU_MSG2 = 7
const VT_FILEOP_SET_OPERATION_FLAGS = 5
const VT_FILEOP_SET_OWNER_WINDOW = 9
const VT_FILEOP_DELETE_ITEMS = 19
const VT_FILEOP_PERFORM_OPERATIONS = 21
const VT_FILEOP_GET_ANY_OPERATIONS_ABORTED = 22

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

/** Everything a built menu owns, so it can be released on every path. */
interface MenuParts {
  owner: unknown
  menu: unknown
  contextMenu: unknown
  menu2: unknown
  menu3: unknown
  /** COM objects other than the context menu (parent or desktop folder). */
  objects: unknown[]
  /** Absolute PIDLs, freed with CoTaskMemFree. */
  pidls: unknown[]
}

/**
 * The real Explorer context menu through koffi, for the shell worker thread
 * (`shell-worker.ts`). Every call here is synchronous and must run on a thread that has called
 * `CoInitializeEx(COINIT_APARTMENTTHREADED)`; `createWinShellNative` does that for its thread.
 *
 * Menu sources (decided from the parents of the paths, see `chooseRoute`):
 * - one path, or several in one folder: `SHBindToParent` of the first, then the parent's
 *   `IShellFolder::GetUIObjectOf` with all child ids (the full Explorer menu);
 * - several folders: `SHCreateDefaultContextMenu` with the desktop folder as `psf` and ABSOLUTE
 *   PIDLs (a reduced menu).
 *
 * FORBIDDEN, shown unsafe or failing in the multi-select spike (RESULTS.md, section B): (a) the
 * first item's parent folder with PIDLs of other folders (S_OK, but the verbs would act on wrong
 * names); (b) the desktop folder's `GetUIObjectOf` with absolute PIDLs (S_OK, but Delete silently
 * does nothing); (c) `IShellItemArray` + `BHID_SFUIObject` for several folders (`E_FAIL`).
 *
 * Each menu gets its own hidden top-level window (built-in STATIC class, never shown, never
 * parented to the app window) as owner of the popup, the menu-message subclass and the invoked
 * command; it is destroyed with the menu. koffi is imported lazily, like the drive API.
 */
export async function createWinShellNative(): Promise<ShellNative> {
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
  koffi.struct('SIQ_DEFCONTEXTMENU', {
    hwnd: 'void *',
    pcmcb: 'void *',
    pidlFolder: 'void *',
    psf: 'void *',
    cidl: 'uint32_t',
    apidl: 'void *',
    punkAssoc: 'void *',
    cKeys: 'uint32_t',
    aKeys: 'void *',
  })

  const CoInitializeEx = ole32.func('int __stdcall CoInitializeEx(void *reserved, uint32_t coinit)')
  const CoUninitialize = ole32.func('void __stdcall CoUninitialize()')
  const CoTaskMemFree = ole32.func('void __stdcall CoTaskMemFree(void *pv)')
  const CoCreateInstance = ole32.func(
    'int __stdcall CoCreateInstance(SIQ_GUID *clsid, void *outer, uint32_t context, SIQ_GUID *iid, _Out_ void **ppv)',
  )
  const SHParseDisplayName = shell32.func(
    'int __stdcall SHParseDisplayName(const char16_t *name, void *bindCtx, _Out_ void **pidl, uint32_t sfgaoIn, void *sfgaoOut)',
  )
  const SHBindToParent = shell32.func(
    'int __stdcall SHBindToParent(void *pidl, SIQ_GUID *riid, _Out_ void **ppv, _Out_ void **childPidl)',
  )
  const SHGetDesktopFolder = shell32.func('int __stdcall SHGetDesktopFolder(_Out_ void **ppv)')
  const SHCreateDefaultContextMenu = shell32.func(
    'int __stdcall SHCreateDefaultContextMenu(SIQ_DEFCONTEXTMENU *info, SIQ_GUID *riid, _Out_ void **ppv)',
  )
  const SHCreateShellItemArrayFromIDLists = shell32.func(
    'int __stdcall SHCreateShellItemArrayFromIDLists(uint32_t count, void **pidls, _Out_ void **ppv)',
  )
  const CreatePopupMenu = user32.func('void * __stdcall CreatePopupMenu()')
  const DestroyMenu = user32.func('int __stdcall DestroyMenu(void *menu)')
  const DeleteMenu = user32.func(
    'int __stdcall DeleteMenu(void *menu, uint32_t position, uint32_t flags)',
  )
  const AppendMenuW = user32.func(
    'int __stdcall AppendMenuW(void *menu, uint32_t flags, uintptr_t idOrSubmenu, const char16_t *text)',
  )
  const GetMenuItemCount = user32.func('int __stdcall GetMenuItemCount(void *menu)')
  const GetMenuItemID = user32.func('uint32_t __stdcall GetMenuItemID(void *menu, int position)')
  const GetMenuStringW = user32.func(
    'int __stdcall GetMenuStringW(void *menu, uint32_t item, _Out_ uint16_t *text, int max, uint32_t flags)',
  )
  // GetKeyState is per-thread input state and a worker thread has no input queue: the live
  // Shift/Ctrl state comes from GetAsyncKeyState.
  const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vk)')
  const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void *hwnd)')
  const CreateWindowExW = user32.func(
    'void * __stdcall CreateWindowExW(uint32_t exStyle, const char16_t *className, const char16_t *title, uint32_t style, int x, int y, int width, int height, void *parent, void *menu, void *instance, void *param)',
  )
  const DestroyWindow = user32.func('int __stdcall DestroyWindow(void *hwnd)')
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
  const FileOpSetFlags = koffi.proto('int __stdcall SIQ_FileOpSetFlags(void *self, uint32_t flags)')
  const FileOpSetOwner = koffi.proto('int __stdcall SIQ_FileOpSetOwner(void *self, void *hwnd)')
  const FileOpDeleteItems = koffi.proto(
    'int __stdcall SIQ_FileOpDeleteItems(void *self, void *items)',
  )
  const FileOpPerform = koffi.proto('int __stdcall SIQ_FileOpPerform(void *self)')
  const FileOpAborted = koffi.proto(
    'int __stdcall SIQ_FileOpAborted(void *self, _Out_ int32_t *aborted)',
  )

  // This thread is its own apartment (the worker is dedicated to the shell). If it already had a
  // different one, RPC_E_CHANGED_MODE is returned and the existing apartment is used as is.
  CoInitializeEx(null, COINIT_APARTMENTTHREADED)
  process.once('exit', () => {
    try {
      CoUninitialize()
    } catch {
      // the thread is going away anyway
    }
  })

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

  const parsePidl = (target: string): unknown => {
    const pidl: unknown[] = [null]
    const hr = Number(SHParseDisplayName(target, null, pidl, 0, null))
    if (failed(hr) || !pidl[0]) throw new ShellMenuError('SHParseDisplayName', hr >>> 0)
    return pidl[0]
  }

  const createOwner = (): unknown => {
    // Built-in STATIC class, no WS_VISIBLE: a real top-level HWND owned by this thread.
    const hwnd = CreateWindowExW(
      0,
      'STATIC',
      'StorageIQ shell owner',
      0,
      0,
      0,
      0,
      0,
      null,
      null,
      null,
      null,
    )
    if (!hwnd) throw new ShellMenuError('CreateWindowExW', E_FAIL)
    return hwnd
  }

  const emptyParts = (): MenuParts => ({
    owner: null,
    menu: null,
    contextMenu: null,
    menu2: null,
    menu3: null,
    objects: [],
    pidls: [],
  })

  const releaseParts = (parts: MenuParts): void => {
    if (parts.menu) DestroyMenu(parts.menu)
    release(parts.menu3)
    release(parts.menu2)
    release(parts.contextMenu)
    for (const object of parts.objects) release(object)
    for (const pidl of parts.pidls) CoTaskMemFree(pidl)
    if (parts.owner) DestroyWindow(parts.owner)
  }

  /** StorageIQ's own items: the submenu, the top-level entries, then a separator. */
  const appendStorageIQItems = (menu: unknown, count: number): void => {
    const entries = storageiqMenuLabels(count, true)
    let submenu: unknown = CreatePopupMenu()
    if (!submenu) throw new Error('CreatePopupMenu failed')
    try {
      for (const entry of entries.filter((candidate) => candidate.inSubmenu)) {
        AppendMenuW(submenu, MF_STRING, STORAGEIQ_COMMAND_IDS[entry.item], entry.label)
      }
      if (!AppendMenuW(menu, MF_POPUP, submenu, STORAGEIQ_MENU_LABELS.submenu))
        throw new Error('AppendMenuW failed')
      submenu = null // owned by `menu` now; DestroyMenu(menu) destroys it
    } finally {
      if (submenu) DestroyMenu(submenu)
    }
    for (const entry of entries.filter((candidate) => !candidate.inSubmenu)) {
      AppendMenuW(menu, MF_STRING, STORAGEIQ_COMMAND_IDS[entry.item], entry.label)
    }
    AppendMenuW(menu, MF_SEPARATOR, 0, null)
  }

  /** IContextMenu of the items: see the route notes in the doc comment above. */
  const createContextMenu = (route: MenuRoute, parts: MenuParts): unknown => {
    const out: unknown[] = [null]
    if (route === 'default') {
      const desktop: unknown[] = [null]
      let hr = Number(SHGetDesktopFolder(desktop))
      if (failed(hr)) throw new ShellMenuError('SHGetDesktopFolder', hr >>> 0)
      parts.objects.push(desktop[0])
      const apidl = Buffer.alloc(8 * parts.pidls.length)
      parts.pidls.forEach((pidl, index) => {
        apidl.writeBigUInt64LE(BigInt(koffi.address(pidl)), index * 8)
      })
      hr = Number(
        SHCreateDefaultContextMenu(
          {
            hwnd: parts.owner,
            pcmcb: null,
            pidlFolder: null,
            psf: desktop[0],
            cidl: parts.pidls.length,
            apidl,
            punkAssoc: null,
            cKeys: 0,
            aKeys: null,
          },
          guid(IID_IContextMenu),
          out,
        ),
      )
      if (failed(hr)) throw new ShellMenuError('SHCreateDefaultContextMenu', hr >>> 0)
      return out[0]
    }
    // One folder: the first item's parent folder, with the child ids of every item (all items
    // share that parent: the route is `single` or `parent`).
    const children: unknown[] = []
    let folder: unknown = null
    for (const pidl of parts.pidls) {
      const parentFolder: unknown[] = [null]
      const child: unknown[] = [null]
      const hr = Number(SHBindToParent(pidl, guid(IID_IShellFolder), parentFolder, child))
      if (failed(hr)) throw new ShellMenuError('SHBindToParent', hr >>> 0)
      if (folder === null) {
        folder = parentFolder[0]
        parts.objects.push(folder)
      } else {
        release(parentFolder[0])
      }
      children.push(child[0])
    }
    const hr = Number(
      koffi.call(
        method(folder, VT_SHELLFOLDER_GET_UI_OBJECT_OF),
        GetUIObjectOf,
        folder,
        parts.owner,
        children.length,
        children,
        guid(IID_IContextMenu),
        null,
        out,
      ),
    )
    if (failed(hr)) throw new ShellMenuError('GetUIObjectOf', hr >>> 0)
    return out[0]
  }

  const verbOf = (contextMenu: unknown, offset: number): string | null => {
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
  }

  /** Recycles `paths` with IFileOperation (Recycle Bin only); blocks until it returns. */
  const recyclePaths = (owner: unknown, paths: readonly string[]): void => {
    const pidls: unknown[] = []
    let items: unknown = null
    let operation: unknown = null
    try {
      for (const target of paths) pidls.push(parsePidl(target))
      const array: unknown[] = [null]
      let hr = Number(SHCreateShellItemArrayFromIDLists(pidls.length, pidls, array))
      if (failed(hr)) throw new ShellMenuError('SHCreateShellItemArrayFromIDLists', hr >>> 0)
      items = array[0]
      const created: unknown[] = [null]
      hr = Number(
        CoCreateInstance(
          guid(CLSID_FileOperation),
          null,
          CLSCTX_INPROC_SERVER | CLSCTX_LOCAL_SERVER,
          guid(IID_IFileOperation),
          created,
        ),
      )
      if (failed(hr)) throw new ShellMenuError('CoCreateInstance', hr >>> 0)
      operation = created[0]
      hr = Number(
        koffi.call(
          method(operation, VT_FILEOP_SET_OPERATION_FLAGS),
          FileOpSetFlags,
          operation,
          FOF_ALLOWUNDO | FOFX_ADDUNDORECORD | FOFX_RECYCLEONDELETE,
        ),
      )
      if (failed(hr)) throw new ShellMenuError('SetOperationFlags', hr >>> 0)
      koffi.call(method(operation, VT_FILEOP_SET_OWNER_WINDOW), FileOpSetOwner, operation, owner)
      hr = Number(
        koffi.call(method(operation, VT_FILEOP_DELETE_ITEMS), FileOpDeleteItems, operation, items),
      )
      if (failed(hr)) throw new ShellMenuError('DeleteItems', hr >>> 0)
      hr = Number(
        koffi.call(method(operation, VT_FILEOP_PERFORM_OPERATIONS), FileOpPerform, operation),
      )
      if (failed(hr)) throw new ShellMenuError('PerformOperations', hr >>> 0)
      const aborted: number[] = [0]
      koffi.call(
        method(operation, VT_FILEOP_GET_ANY_OPERATIONS_ABORTED),
        FileOpAborted,
        operation,
        aborted,
      )
      if (aborted[0] !== 0) throw new ShellMenuError('PerformOperations', HRESULT_CANCELLED)
    } finally {
      release(items)
      release(operation)
      for (const pidl of pidls) CoTaskMemFree(pidl)
    }
  }

  const makeBuilt = (parts: MenuParts, paths: readonly string[]): BuiltShellMenu => {
    const { owner, contextMenu, menu2, menu3 } = parts
    const builtMenu = parts.menu
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
        // The window subclass and its koffi callback live exactly as long as the popup.
        const proc = koffi.register(forwardMenuMessage, koffi.pointer(SubclassProc))
        let subclassed = false
        try {
          subclassed = Boolean(SetWindowSubclass(owner, proc, SUBCLASS_ID, 0))
          if (!subclassed) throw new Error('SetWindowSubclass failed')
          // TrackPopupMenuEx needs its owner in the foreground, or the menu does not close
          // when the user clicks elsewhere (TrackPopupMenu remarks).
          SetForegroundWindow(owner)
          return Number(
            TrackPopupMenuEx(builtMenu, TPM_RETURNCMD | TPM_RIGHTBUTTON, x, y, owner, null),
          )
        } finally {
          if (subclassed) RemoveWindowSubclass(owner, proc, SUBCLASS_ID)
          koffi.unregister(proc)
        }
      },

      verb: (offset) => (contextMenu ? verbOf(contextMenu, offset) : null),

      offsetOfVerb(verb) {
        if (!contextMenu) return null
        const count = Number(GetMenuItemCount(builtMenu))
        for (let position = 0; position < count; position += 1) {
          const id = Number(GetMenuItemID(builtMenu, position))
          if (id < SHELL_FIRST_ID || id > SHELL_LAST_ID) continue
          if (verbOf(contextMenu, id - SHELL_FIRST_ID)?.toLowerCase() === verb.toLowerCase())
            return id - SHELL_FIRST_ID
        }
        return null
      },

      invoke(offset, x, y) {
        if (!contextMenu) throw new Error('this menu has no shell items')
        // Explorer reads the live key state: Shift may have been released since the right-click.
        const shiftDown = Number(GetAsyncKeyState(VK_SHIFT)) < 0
        const controlDown = Number(GetAsyncKeyState(VK_CONTROL)) < 0
        const info = {
          cbSize: koffi.sizeof(CMINVOKECOMMANDINFOEX),
          fMask:
            CMIC_MASK_UNICODE |
            CMIC_MASK_PTINVOKE |
            (shiftDown ? CMIC_MASK_SHIFT_DOWN : 0) |
            (controlDown ? CMIC_MASK_CONTROL_DOWN : 0),
          hwnd: owner,
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
        // Nothing is asynchronous: no CMIC_MASK_ASYNCOK (the delete verb ignores it anyway), the
        // call returns when the shell command did, on this worker thread.
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

      recycle() {
        if (contextMenu) throw new Error('only the fallback menu recycles with IFileOperation')
        recyclePaths(owner, paths)
      },

      release: () => releaseParts(parts),
    }
  }

  return {
    build(route: MenuRoute, paths: readonly string[], options: BuildOptions): BuiltShellMenu {
      const parts = emptyParts()
      try {
        parts.owner = createOwner()
        for (const target of paths) parts.pidls.push(parsePidl(target))
        parts.contextMenu = createContextMenu(route, parts)
        parts.menu3 = queryInterface(parts.contextMenu, IID_IContextMenu3)
        parts.menu2 =
          parts.menu3 === null ? queryInterface(parts.contextMenu, IID_IContextMenu2) : null
        parts.menu = CreatePopupMenu()
        if (!parts.menu) throw new Error('CreatePopupMenu failed')
        appendStorageIQItems(parts.menu, paths.length)
        const flags = CMF_NORMAL | CMF_EXPLORE | (options.extended ? CMF_EXTENDEDVERBS : 0)
        const hr = Number(
          koffi.call(
            method(parts.contextMenu, VT_CONTEXTMENU_QUERY_CONTEXT_MENU),
            QueryContextMenu,
            parts.contextMenu,
            parts.menu,
            Number(GetMenuItemCount(parts.menu)),
            SHELL_FIRST_ID,
            SHELL_LAST_ID,
            flags,
          ),
        )
        if (failed(hr)) throw new ShellMenuError('QueryContextMenu', hr >>> 0)
        if (options.hideDestructive) {
          const { menu, contextMenu } = parts
          hideDestructiveVerbs({
            count: () => Number(GetMenuItemCount(menu)),
            idAt: (position) => {
              const id = Number(GetMenuItemID(menu, position))
              return id === 0xffffffff ? 0 : id
            },
            verbOf: (offset) => verbOf(contextMenu, offset),
            removeAt: (position) => {
              DeleteMenu(menu, position, MF_BYPOSITION)
            },
          })
        }
      } catch (error) {
        releaseParts(parts)
        throw error
      }
      return makeBuilt(parts, paths)
    },

    buildFallback(paths: readonly string[]): BuiltShellMenu {
      const parts = emptyParts()
      try {
        parts.owner = createOwner()
        parts.menu = CreatePopupMenu()
        if (!parts.menu) throw new Error('CreatePopupMenu failed')
        appendStorageIQItems(parts.menu, paths.length)
        AppendMenuW(
          parts.menu,
          MF_STRING,
          STORAGEIQ_COMMAND_IDS.delete,
          STORAGEIQ_MENU_LABELS.delete,
        )
      } catch (error) {
        releaseParts(parts)
        throw error
      }
      return makeBuilt(parts, paths)
    },
  }
}

/**
 * Test seam (native tests only): builds the menu for `paths` with the same routing as a real
 * request, without showing it, and invokes the shell verb named `verb` (for example `delete`).
 * Blocks until the command returned, so call it on a worker thread, never on the UI thread.
 */
export function invokeVerbForTest(
  native: ShellNative,
  paths: readonly string[],
  verb: string,
): void {
  const menu = native.build(chooseRoute(paths), paths, { extended: false, hideDestructive: false })
  try {
    const offset = menu.offsetOfVerb(verb)
    if (offset === null) throw new Error(`the menu has no ${verb} item`)
    menu.invoke(offset, 0, 0)
  } finally {
    menu.release()
  }
}
