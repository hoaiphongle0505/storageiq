import { describe, expect, it, vi } from 'vitest'
import type { ScanFailed } from '@shared/scan-types'
import { type IpcEventSource, subscribe } from './subscribe'

type RawListener = (event: unknown, ...args: unknown[]) => void

function createFakeSource() {
  const listeners = new Map<string, Set<RawListener>>()
  const source: IpcEventSource = {
    on(channel, listener) {
      const set = listeners.get(channel) ?? new Set<RawListener>()
      set.add(listener)
      listeners.set(channel, set)
    },
    removeListener(channel, listener) {
      listeners.get(channel)?.delete(listener)
    },
  }
  const emit = (channel: string, ...args: unknown[]) => {
    for (const listener of listeners.get(channel) ?? []) listener({ sender: 'secret' }, ...args)
  }
  const count = (channel: string) => listeners.get(channel)?.size ?? 0
  return { source, emit, count }
}

const failed: ScanFailed = { scanId: 'scan-1', message: 'boom' }

describe('subscribe', () => {
  it('passes only the payload to the callback, never the IpcRendererEvent', () => {
    const { source, emit } = createFakeSource()
    const callback = vi.fn()
    subscribe(source, 'scan:failed', callback)

    emit('scan:failed', failed)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0]).toEqual([failed])
  })

  it('returns an unsubscribe function that removes exactly that listener', () => {
    const { source, emit, count } = createFakeSource()
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribe(source, 'scan:failed', first)
    subscribe(source, 'scan:failed', second)

    unsubscribeFirst()
    emit('scan:failed', failed)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith(failed)
    expect(count('scan:failed')).toBe(1)
  })
})
