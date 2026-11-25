import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { DriveDetails, DriveInfo, Places } from '@shared/scan-types'
import { createDriveHandlers, type DriveHandlerDeps } from './drive-handlers'
import { InvalidIpcArgumentsError } from './parse-args'

const event = {} as IpcMainInvokeEvent
const drives: DriveInfo[] = [
  { root: 'C:\\', label: 'Local Disk', kind: 'fixed', totalBytes: 100, freeBytes: 40 },
]
const details: DriveDetails = {
  root: 'C:\\',
  totalBytes: 100,
  freeBytes: 40,
  clusterBytes: 4096,
  fileSystem: 'NTFS',
}
const places: Places = {
  places: [{ kind: 'documents', label: 'Documents', path: 'C:\\Users\\Ana\\Documents' }],
  recent: ['D:\\Photos'],
}

function setup() {
  const deps: DriveHandlerDeps = {
    listDrives: vi.fn(async () => drives),
    driveDetails: vi.fn(async () => details),
    listPlaces: vi.fn(async () => places),
  }
  return { deps, handlers: createDriveHandlers(deps) }
}

describe('drives:list', () => {
  it('returns the listed drives and takes no arguments', async () => {
    const { handlers } = setup()
    await expect(Promise.resolve(handlers['drives:list'].handle(event))).resolves.toEqual(drives)
    expect(() => handlers['drives:list'].parseArgs(['C:\\'])).toThrow(InvalidIpcArgumentsError)
  })
})

describe('drive:info', () => {
  it.each([
    ['C:\\', 'C:\\'],
    ['c:', 'C:\\'],
    ['d:\\', 'D:\\'],
  ])('accepts the drive root %j', (input, root) => {
    const { handlers } = setup()
    expect(handlers['drive:info'].parseArgs([input])).toEqual([root])
  })

  it.each([[[]], [['C:\\Windows']], [['\\\\server\\share']], [[3]], [['C:\\', 'D:\\']]])(
    'rejects %j',
    (args) => {
      const { handlers } = setup()
      expect(() => handlers['drive:info'].parseArgs(args)).toThrow(InvalidIpcArgumentsError)
    },
  )

  it('returns space, cluster size and file system', async () => {
    const { handlers, deps } = setup()
    await expect(Promise.resolve(handlers['drive:info'].handle(event, 'C:\\'))).resolves.toEqual(
      details,
    )
    expect(deps.driveDetails).toHaveBeenCalledWith('C:\\')
  })
})

describe('places:list', () => {
  it('returns the places and takes no arguments', async () => {
    const { handlers } = setup()
    await expect(Promise.resolve(handlers['places:list'].handle(event))).resolves.toEqual(places)
    expect(() => handlers['places:list'].parseArgs([1])).toThrow(InvalidIpcArgumentsError)
  })
})
