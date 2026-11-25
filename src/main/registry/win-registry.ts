import type { RegistryAdapter, RegistryHive } from './registry-adapter'

const HKEY_CURRENT_USER = 0x80000001
const HKEY_LOCAL_MACHINE = 0x80000002
const KEY_QUERY_VALUE = 0x1
const KEY_SET_VALUE = 0x2
const KEY_CREATE_SUB_KEY = 0x4
const REG_SZ = 1
const REG_EXPAND_SZ = 2
const ERROR_SUCCESS = 0
const ERROR_FILE_NOT_FOUND = 2
const ERROR_MORE_DATA = 234
/** The documented limit for a registry value name and for string data, in characters. */
const MAX_CHARS = 32_767

export class RegistryError extends Error {
  readonly status: number
  constructor(call: string, status: number) {
    super(`${call} failed with Windows error ${status}`)
    this.name = 'RegistryError'
    this.status = status
  }
}

type Handle = number | bigint

interface Advapi32 {
  create(root: number, key: string): Handle
  open(root: number, key: string, access: number): Handle | null
  setValue(handle: Handle, name: string, data: Buffer): number
  queryValue(handle: Handle, name: string): string | null
  deleteValue(handle: Handle, name: string): number
  deleteTree(root: number, key: string): number
  close(handle: Handle): void
}

/** Loads advapi32 through koffi on first use, so importing this module never loads koffi. */
function bindAdvapi32(): Advapi32 {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi')
  const lib = koffi.load('advapi32.dll')
  const regCreateKeyExW = lib.func(
    'int32_t __stdcall RegCreateKeyExW(uintptr_t hKey, const char16_t *lpSubKey, ' +
      'uint32_t Reserved, void *lpClass, uint32_t dwOptions, uint32_t samDesired, ' +
      'void *lpSecurityAttributes, _Out_ uintptr_t *phkResult, _Out_ uint32_t *lpdwDisposition)',
  )
  const regOpenKeyExW = lib.func(
    'int32_t __stdcall RegOpenKeyExW(uintptr_t hKey, const char16_t *lpSubKey, ' +
      'uint32_t ulOptions, uint32_t samDesired, _Out_ uintptr_t *phkResult)',
  )
  const regSetValueExW = lib.func(
    'int32_t __stdcall RegSetValueExW(uintptr_t hKey, const char16_t *lpValueName, ' +
      'uint32_t Reserved, uint32_t dwType, const void *lpData, uint32_t cbData)',
  )
  const regQueryValueExW = lib.func(
    'int32_t __stdcall RegQueryValueExW(uintptr_t hKey, const char16_t *lpValueName, ' +
      'void *lpReserved, _Out_ uint32_t *lpType, void *lpData, _Inout_ uint32_t *lpcbData)',
  )
  const regDeleteValueW = lib.func(
    'int32_t __stdcall RegDeleteValueW(uintptr_t hKey, const char16_t *lpValueName)',
  )
  const regDeleteTreeW = lib.func(
    'int32_t __stdcall RegDeleteTreeW(uintptr_t hKey, const char16_t *lpSubKey)',
  )
  const regCloseKey = lib.func('int32_t __stdcall RegCloseKey(uintptr_t hKey)')

  /** The empty name is the key's (Default) value: Windows wants a NULL pointer for it. */
  const nameArg = (name: string): string | null => (name === '' ? null : name)

  return {
    create(root, key) {
      const out: Handle[] = [0]
      const status = Number(
        regCreateKeyExW(root, key, 0, null, 0, KEY_SET_VALUE | KEY_CREATE_SUB_KEY, null, out, [0]),
      )
      if (status !== ERROR_SUCCESS) throw new RegistryError('RegCreateKeyExW', status)
      return out[0] ?? 0
    },
    open(root, key, access) {
      const out: Handle[] = [0]
      const status = Number(regOpenKeyExW(root, key, 0, access, out))
      if (status === ERROR_FILE_NOT_FOUND) return null
      if (status !== ERROR_SUCCESS) throw new RegistryError('RegOpenKeyExW', status)
      return out[0] ?? 0
    },
    setValue(handle, name, data) {
      return Number(regSetValueExW(handle, nameArg(name), 0, REG_SZ, data, data.length))
    },
    queryValue(handle, name) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const type = [0]
        const size = [0]
        const sizing = Number(regQueryValueExW(handle, nameArg(name), null, type, null, size))
        if (sizing === ERROR_FILE_NOT_FOUND) return null
        if (sizing !== ERROR_SUCCESS) throw new RegistryError('RegQueryValueExW', sizing)
        if (type[0] !== REG_SZ && type[0] !== REG_EXPAND_SZ) return null
        // Room for a missing terminator; the value may also grow between the two calls.
        const buffer = Buffer.alloc((size[0] ?? 0) + 2)
        const capacity = [buffer.length - 2]
        const status = Number(regQueryValueExW(handle, nameArg(name), null, type, buffer, capacity))
        if (status === ERROR_MORE_DATA) continue
        if (status === ERROR_FILE_NOT_FOUND) return null
        if (status !== ERROR_SUCCESS) throw new RegistryError('RegQueryValueExW', status)
        const text = buffer.subarray(0, capacity[0] ?? 0).toString('utf16le')
        const end = text.indexOf('\0')
        return end === -1 ? text : text.slice(0, end)
      }
      throw new RegistryError('RegQueryValueExW', ERROR_MORE_DATA)
    },
    deleteValue: (handle, name) => Number(regDeleteValueW(handle, nameArg(name))),
    deleteTree: (root, key) => Number(regDeleteTreeW(root, key)),
    close(handle) {
      regCloseKey(handle)
    },
  }
}

function checkName(label: string, value: string, allowEmpty: boolean): void {
  if (value.includes('\0')) throw new RangeError(`${label} contains a NUL character`)
  if (value.length > MAX_CHARS) throw new RangeError(`${label} is longer than ${MAX_CHARS}`)
  if (!allowEmpty && value === '') throw new RangeError(`${label} is empty`)
}

const rootOf = (hive: RegistryHive): number =>
  hive === 'HKCU' ? HKEY_CURRENT_USER : HKEY_LOCAL_MACHINE

/** The Windows registry through advapi32 (koffi), synchronously: each call takes microseconds. */
export function createWinRegistry(): RegistryAdapter {
  let api: Advapi32 | null = null
  const advapi = (): Advapi32 => (api ??= bindAdvapi32())

  return {
    getString(hive, key, name) {
      checkName('key', key, false)
      checkName('name', name, true)
      const native = advapi()
      const handle = native.open(rootOf(hive), key, KEY_QUERY_VALUE)
      if (handle === null) return null
      try {
        return native.queryValue(handle, name)
      } finally {
        native.close(handle)
      }
    },
    setString(key, name, value) {
      checkName('key', key, false)
      checkName('name', name, true)
      checkName('value', value, true)
      const native = advapi()
      const handle = native.create(HKEY_CURRENT_USER, key)
      try {
        const status = native.setValue(handle, name, Buffer.from(`${value}\0`, 'utf16le'))
        if (status !== ERROR_SUCCESS) throw new RegistryError('RegSetValueExW', status)
      } finally {
        native.close(handle)
      }
    },
    deleteValue(key, name) {
      checkName('key', key, false)
      checkName('name', name, true)
      const native = advapi()
      const handle = native.open(HKEY_CURRENT_USER, key, KEY_SET_VALUE)
      if (handle === null) return
      try {
        const status = native.deleteValue(handle, name)
        if (status !== ERROR_SUCCESS && status !== ERROR_FILE_NOT_FOUND) {
          throw new RegistryError('RegDeleteValueW', status)
        }
      } finally {
        native.close(handle)
      }
    },
    deleteTree(key) {
      checkName('key', key, false)
      const status = advapi().deleteTree(HKEY_CURRENT_USER, key)
      if (status !== ERROR_SUCCESS && status !== ERROR_FILE_NOT_FOUND) {
        throw new RegistryError('RegDeleteTreeW', status)
      }
    },
  }
}
