import { describe, expect, it } from 'vitest'
import {
  findScanArgument,
  MAX_LAUNCH_PATH_CHARS,
  parseSecondInstanceData,
  resolveLaunchRequest,
} from './launch-args'

const dir = { isDirectory: () => true }
const file = { isDirectory: () => false }
const statDir = () => Promise.resolve(dir)

describe('findScanArgument', () => {
  it('finds --scan in a packaged argv', () => {
    expect(findScanArgument(['C:\\App\\StorageIQ.exe', '--scan', 'D:\\Data'])).toBe('D:\\Data')
  })

  it('finds --scan in a dev argv with the app folder', () => {
    expect(findScanArgument(['electron.exe', '.', '--scan', 'D:\\Data'])).toBe('D:\\Data')
  })

  it('finds --scan=value', () => {
    expect(findScanArgument(['app.exe', '--scan=D:\\Data'])).toBe('D:\\Data')
  })

  it('ignores Chromium switches before and after', () => {
    expect(
      findScanArgument(['app.exe', '--no-sandbox', '--scan', 'D:\\Data', '--allow-file-access']),
    ).toBe('D:\\Data')
  })

  it('ignores a --scan after a lone --', () => {
    expect(findScanArgument(['app.exe', '--', '--scan', 'D:\\Data'])).toBeNull()
  })

  it('repairs a drive root that arrives as C:"', () => {
    expect(findScanArgument(['app.exe', '--scan', 'C:"'])).toBe('C:\\')
  })

  it('repairs a quoted drive root followed by more arguments', () => {
    expect(findScanArgument(['app.exe', '--scan', 'C:" --extra'])).toBe('C:\\')
    expect(findScanArgument(['app.exe', '--scan=D:" --x'])).toBe('D:\\')
  })

  it('keeps a path with spaces', () => {
    expect(findScanArgument(['app.exe', '--scan', 'C:\\My Files\\Ünï côde'])).toBe(
      'C:\\My Files\\Ünï côde',
    )
  })

  it('returns an empty string for --scan without a value', () => {
    expect(findScanArgument(['app.exe', '--scan'])).toBe('')
    expect(findScanArgument(['app.exe', '--scan', '--no-sandbox'])).toBe('')
  })

  it('returns null without the flag', () => {
    expect(findScanArgument(['app.exe', '--no-sandbox'])).toBeNull()
    expect(findScanArgument([])).toBeNull()
  })

  it('trims leading and trailing whitespace', () => {
    expect(findScanArgument(['app.exe', '--scan', '  D:\\Data  '])).toBe('D:\\Data')
  })
})

describe('resolveLaunchRequest', () => {
  it('returns null when there is no flag', async () => {
    await expect(resolveLaunchRequest(['app.exe'], statDir)).resolves.toBeNull()
  })

  it('accepts a drive root', async () => {
    await expect(resolveLaunchRequest(['app.exe', '--scan', 'C:"'], statDir)).resolves.toEqual({
      kind: 'scan',
      path: 'C:\\',
    })
  })

  it('rejects a UNC path', async () => {
    for (const value of ['\\\\server\\share', '//server/share', '\\\\?\\C:\\x']) {
      await expect(resolveLaunchRequest(['a', '--scan', value], statDir)).resolves.toEqual({
        kind: 'invalid',
        message: 'StorageIQ scans local folders and drives. Network paths are not supported.',
      })
    }
  })

  it('rejects a relative path', async () => {
    await expect(resolveLaunchRequest(['a', '--scan', 'Docs\\x'], statDir)).resolves.toEqual({
      kind: 'invalid',
      message: 'Choose a full path such as C:\\Folder.',
    })
  })

  it('rejects C: without a separator', async () => {
    await expect(resolveLaunchRequest(['a', '--scan', 'C:x'], statDir)).resolves.toEqual({
      kind: 'invalid',
      message: 'Choose a full path such as C:\\Folder.',
    })
    await expect(resolveLaunchRequest(['a', '--scan', 'C:'], statDir)).resolves.toMatchObject({
      kind: 'invalid',
    })
  })

  it('rejects a path over 1024 characters', async () => {
    expect(MAX_LAUNCH_PATH_CHARS).toBe(1024)
    const long = `C:\\${'a'.repeat(MAX_LAUNCH_PATH_CHARS)}`
    await expect(resolveLaunchRequest(['a', '--scan', long], statDir)).resolves.toEqual({
      kind: 'invalid',
      message: 'That path is too long or not a valid location.',
    })
  })

  it('rejects control characters', async () => {
    for (const bad of ['C:\\a\u0007b', 'C:\\a\u0000b']) {
      await expect(resolveLaunchRequest(['a', '--scan', bad], statDir)).resolves.toEqual({
        kind: 'invalid',
        message: 'That path is too long or not a valid location.',
      })
    }
  })

  it('treats a missing value as invalid, not ignored', async () => {
    await expect(resolveLaunchRequest(['a', '--scan'], statDir)).resolves.toEqual({
      kind: 'invalid',
      message: 'That path is too long or not a valid location.',
    })
  })

  it('rejects a file', async () => {
    await expect(
      resolveLaunchRequest(['a', '--scan', 'C:\\a.txt'], () => Promise.resolve(file)),
    ).resolves.toEqual({ kind: 'invalid', message: 'That folder could not be found.' })
  })

  it('rejects a missing folder', async () => {
    await expect(
      resolveLaunchRequest(['a', '--scan', 'C:\\gone'], () => Promise.reject(new Error('ENOENT'))),
    ).resolves.toEqual({ kind: 'invalid', message: 'That folder could not be found.' })
  })

  it('messages never include the path', async () => {
    const secret = 'C:\\Secret-Name'
    const results = await Promise.all([
      resolveLaunchRequest(['a', '--scan', secret], () => Promise.reject(new Error(secret))),
      resolveLaunchRequest(['a', '--scan', secret], () => Promise.resolve(file)),
      resolveLaunchRequest(['a', '--scan', '\\\\Secret-Name\\x'], statDir),
      resolveLaunchRequest(['a', '--scan', 'Secret-Name'], statDir),
      resolveLaunchRequest(['a', '--scan', `C:\\Secret-Name\u0001${'x'.repeat(2000)}`], statDir),
    ])
    for (const result of results) {
      expect(result).toMatchObject({ kind: 'invalid' })
      expect(JSON.stringify(result)).not.toContain('Secret-Name')
    }
  })

  it('normalizes forward slashes', async () => {
    await expect(
      resolveLaunchRequest(['a', '--scan', 'C:/Users/Ana/../Bob'], statDir),
    ).resolves.toEqual({ kind: 'scan', path: 'C:\\Users\\Bob' })
  })
})

describe('parseSecondInstanceData', () => {
  it('turns { scan: value } into a --scan argv', () => {
    expect(parseSecondInstanceData({ scan: 'D:\\Data' })).toEqual(['--scan', 'D:\\Data'])
  })

  it('does nothing for { scan: null } or a missing scan', () => {
    expect(parseSecondInstanceData({ scan: null })).toEqual([])
    expect(parseSecondInstanceData({})).toEqual([])
  })

  it('ignores anything that is not a plain object with a string or null scan', () => {
    const bads = [undefined, null, 'D:\\Data', 7, ['--scan', 'D:\\'], { scan: 5 }, { scan: {} }]
    for (const bad of bads) {
      expect(parseSecondInstanceData(bad)).toBeNull()
    }
    class Fake {
      scan = 'D:\\Data'
    }
    expect(parseSecondInstanceData(new Fake())).toBeNull()
  })

  it('ignores unexpected extra keys', () => {
    expect(parseSecondInstanceData({ scan: 'D:\\Data', extra: 1 })).toBeNull()
  })

  it('reports an over-long value as invalid input instead of passing it on', () => {
    const argv = parseSecondInstanceData({ scan: 'C:\\' + 'a'.repeat(MAX_LAUNCH_PATH_CHARS) })
    expect(argv).toEqual(['--scan', ''])
  })
})
