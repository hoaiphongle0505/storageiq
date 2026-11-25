import path from 'node:path'
import type { LaunchRequest } from '@shared/ipc-contract'
import { DRIVE_ABSOLUTE, isNetworkRoot } from '../ipc/scan-handlers'

export const SCAN_FLAG = '--scan'
export const MAX_LAUNCH_PATH_CHARS = 1024

export type LaunchStat = (path: string) => Promise<{ isDirectory(): boolean }>

const MESSAGE_INVALID = 'That path is too long or not a valid location.'
const MESSAGE_NETWORK = 'StorageIQ scans local folders and drives. Network paths are not supported.'
const MESSAGE_RELATIVE = 'Choose a full path such as C:\\Folder.'
const MESSAGE_NOT_FOUND = 'That folder could not be found.'

/**
 * `"C:\"` reaches Chromium's argv as `C:"` (the `\"` is an escaped quote), swallowing later
 * arguments. Everything from the first quote on is dropped and the lost backslash is restored.
 */
function repairQuote(value: string): string {
  const quote = value.indexOf('"')
  const repaired = quote === -1 ? value : `${value.slice(0, quote)}\\`
  return repaired.trim()
}

/**
 * The raw value after `--scan` (or `--scan=value`); null when the flag is absent. The whole
 * array is searched: packaged is `[exe, …]`, dev is `[electron, '.', …]`, and Chromium may add
 * switches anywhere. Nothing after a lone `--` counts.
 */
export function findScanArgument(argv: readonly string[]): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? ''
    if (arg === '--') return null
    if (arg === SCAN_FLAG) {
      const next = argv[index + 1]
      return next === undefined || next.startsWith('--') ? '' : repairQuote(next)
    }
    if (arg.startsWith(`${SCAN_FLAG}=`)) return repairQuote(arg.slice(SCAN_FLAG.length + 1))
  }
  return null
}

/** Control characters, including NUL, never belong in a path. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * Validates a launch's `--scan` value the way `scan:start` does. null: no flag at all. The
 * messages never contain the path.
 */
export async function resolveLaunchRequest(
  argv: readonly string[],
  stat: LaunchStat,
): Promise<LaunchRequest | null> {
  const value = findScanArgument(argv)
  if (value === null) return null
  const invalid = (message: string): LaunchRequest => ({ kind: 'invalid', message })
  if (value.length < 3 || value.length > MAX_LAUNCH_PATH_CHARS || CONTROL_CHARS.test(value)) {
    return invalid(MESSAGE_INVALID)
  }
  if (isNetworkRoot(value)) return invalid(MESSAGE_NETWORK)
  if (!DRIVE_ABSOLUTE.test(value)) return invalid(MESSAGE_RELATIVE)
  let isDirectory: boolean
  try {
    isDirectory = (await stat(value)).isDirectory()
  } catch {
    isDirectory = false
  }
  if (!isDirectory) return invalid(MESSAGE_NOT_FOUND)
  return { kind: 'scan', path: path.win32.normalize(value) }
}
