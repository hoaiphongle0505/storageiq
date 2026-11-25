import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { LaunchRequest } from '@shared/ipc-contract'
import { createLaunchHandlers } from './launch-handlers'
import { InvalidIpcArgumentsError } from './parse-args'

describe('launch handlers', () => {
  it('take-request takes no arguments and returns the coordinator’s request', () => {
    const request: LaunchRequest = { kind: 'scan', path: 'D:\\Data' }
    const take = vi.fn<() => LaunchRequest | null>(() => request)
    const handlers = createLaunchHandlers({ take })
    expect(handlers['launch:take-request'].parseArgs([])).toEqual([])
    expect(() => handlers['launch:take-request'].parseArgs(['x'])).toThrow(InvalidIpcArgumentsError)
    expect(handlers['launch:take-request'].handle({} as IpcMainInvokeEvent)).toBe(request)
    take.mockReturnValueOnce(null)
    expect(handlers['launch:take-request'].handle({} as IpcMainInvokeEvent)).toBeNull()
  })
})
