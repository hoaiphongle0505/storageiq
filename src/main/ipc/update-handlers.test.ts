import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/ipc-contract'
import { InvalidIpcArgumentsError } from './parse-args'
import { createUpdateHandlers } from './update-handlers'

const event = {} as IpcMainInvokeEvent
const available: UpdateState = { kind: 'available', version: '0.3.0' }

describe('update handlers', () => {
  it('update:get-state, update:check, update:download and update:get-release-notes call the updater', () => {
    const downloadUpdate = vi.fn()
    const handlers = createUpdateHandlers({
      getUpdateState: () => available,
      checkForUpdates: () => ({ kind: 'checking' }),
      downloadUpdate,
      getReleaseNotes: () => ({ version: '0.3.0', text: 'Notes' }),
    })
    expect(handlers['update:get-state'].handle(event)).toEqual(available)
    expect(handlers['update:check'].handle(event)).toEqual({ kind: 'checking' })
    handlers['update:download'].handle(event)
    expect(downloadUpdate).toHaveBeenCalledTimes(1)
    expect(handlers['update:get-release-notes'].handle(event)).toEqual({
      version: '0.3.0',
      text: 'Notes',
    })
  })

  it('update:check and update:download reject any argument', () => {
    const handlers = createUpdateHandlers({
      getUpdateState: () => available,
      checkForUpdates: () => available,
      downloadUpdate: vi.fn(),
      getReleaseNotes: () => null,
    })
    for (const channel of [
      'update:get-state',
      'update:check',
      'update:download',
      'update:get-release-notes',
    ] as const) {
      expect(() => handlers[channel].parseArgs(['x'])).toThrow(InvalidIpcArgumentsError)
    }
  })

  it('the handlers answer idle when there is no updater', () => {
    // The shape main passes while no updater exists (see index.ts).
    interface UpdaterShape {
      state: UpdateState
      checkNow(): UpdateState
      download(): void
      releaseNotes: null
    }
    const getUpdater = (): UpdaterShape | null => null
    const handlers = createUpdateHandlers({
      getUpdateState: () => getUpdater()?.state ?? { kind: 'idle' },
      checkForUpdates: () => getUpdater()?.checkNow() ?? { kind: 'idle' },
      downloadUpdate: () => getUpdater()?.download(),
      getReleaseNotes: () => getUpdater()?.releaseNotes ?? null,
    })
    expect(handlers['update:get-state'].handle(event)).toEqual({ kind: 'idle' })
    expect(handlers['update:check'].handle(event)).toEqual({ kind: 'idle' })
    expect(() => handlers['update:download'].handle(event)).not.toThrow()
    expect(handlers['update:get-release-notes'].handle(event)).toBeNull()
  })
})
