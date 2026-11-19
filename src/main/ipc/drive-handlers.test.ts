import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { DriveInfo } from '@shared/scan-types'
import { createDriveHandlers } from './drive-handlers'
import { InvalidIpcArgumentsError } from './parse-args'

const event = {} as IpcMainInvokeEvent
const drives: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 100, freeBytes: 40 },
]

describe('drives:list', () => {
  it('returns the listed drives', async () => {
    const handlers = createDriveHandlers({ listDrives: vi.fn(async () => drives) })
    await expect(Promise.resolve(handlers['drives:list'].handle(event))).resolves.toEqual(drives)
  })

  it('takes no arguments', () => {
    const handlers = createDriveHandlers({ listDrives: vi.fn(async () => drives) })
    expect(() => handlers['drives:list'].parseArgs(['C:\\'])).toThrow(InvalidIpcArgumentsError)
  })
})
