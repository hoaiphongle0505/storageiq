import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { ScanVolume } from '@shared/scanner-protocol'
import { InvalidIpcArgumentsError } from './parse-args'
import { createScanHandlers } from './scan-handlers'

const event = {} as IpcMainInvokeEvent
const VOLUME: ScanVolume = { clusterBytes: 8192, freeBytes: null }

function setup() {
  const folders = new Set(['D:\\Photos', 'D:/Photos', 'C:\\'])
  const files = new Set(['D:\\notes.txt'])
  const start = vi.fn(() => ({ scanId: 'scan-1' }))
  const cancel = vi.fn()
  const stat = vi.fn(async (target: string) => {
    if (folders.has(target)) return { isDirectory: () => true }
    if (files.has(target)) return { isDirectory: () => false }
    throw Object.assign(new Error(`ENOENT: ${target}`), { code: 'ENOENT' })
  })
  const volumeFor = vi.fn(async () => VOLUME)
  const addRecent = vi.fn(async () => undefined)
  return {
    handlers: createScanHandlers({ scanService: { start, cancel }, stat, volumeFor, addRecent }),
    start,
    cancel,
    volumeFor,
    addRecent,
  }
}

describe('scan:start', () => {
  it('accepts an existing absolute local folder', async () => {
    const { handlers } = setup()
    await expect(handlers['scan:start'].parseArgs(['D:\\Photos'])).resolves.toEqual(['D:\\Photos'])
    await expect(handlers['scan:start'].parseArgs(['C:\\'])).resolves.toEqual(['C:\\'])
  })

  it('normalizes forward slashes', async () => {
    const { handlers } = setup()
    await expect(handlers['scan:start'].parseArgs(['D:/Photos'])).resolves.toEqual(['D:\\Photos'])
  })

  it.each([
    ['no argument', []],
    ['two arguments', ['D:\\Photos', 'D:\\Music']],
    ['a number', [42]],
    ['a relative path', ['Photos']],
    ['a root-relative path', ['\\Photos']],
    ['a UNC path', ['\\\\server\\share']],
    ['a forward-slash UNC path', ['//server/share']],
    ['a missing folder', ['D:\\Missing']],
    ['a file', ['D:\\notes.txt']],
  ])('rejects %s', async (_label, args) => {
    const { handlers } = setup()
    await expect(
      Promise.resolve().then(() => handlers['scan:start'].parseArgs(args)),
    ).rejects.toThrow(InvalidIpcArgumentsError)
  })

  it('starts the scan with the drive’s cluster size and remembers the path', async () => {
    const { handlers, start, volumeFor, addRecent } = setup()
    await expect(
      Promise.resolve(handlers['scan:start'].handle(event, 'D:\\Photos')),
    ).resolves.toEqual({ scanId: 'scan-1' })
    expect(volumeFor).toHaveBeenCalledWith('D:\\Photos')
    expect(start).toHaveBeenCalledWith('D:\\Photos', VOLUME)
    expect(addRecent).toHaveBeenCalledWith('D:\\Photos')
  })
})

describe('scan:cancel', () => {
  it('accepts one string', () => {
    const { handlers } = setup()
    expect(handlers['scan:cancel'].parseArgs(['scan-1'])).toEqual(['scan-1'])
  })

  it.each([[[]], [[7]]])('rejects %j', (args) => {
    const { handlers } = setup()
    expect(() => handlers['scan:cancel'].parseArgs(args)).toThrow(InvalidIpcArgumentsError)
  })

  it('forwards the cancel to the scan service', () => {
    const { handlers, cancel } = setup()
    handlers['scan:cancel'].handle(event, 'scan-1')
    expect(cancel).toHaveBeenCalledWith('scan-1')
  })
})
