import { describe, expect, it, vi } from 'vitest'
import type { ScanFailed } from '@shared/scan-types'
import { createEventSender, type EventWindow } from './send-event'

const failed: ScanFailed = { scanId: 'scan-1', message: 'The scanner process stopped.' }

function fakeWindow(state: { windowGone?: boolean; contentsGone?: boolean } = {}) {
  const send = vi.fn()
  const window: EventWindow = {
    isDestroyed: () => state.windowGone === true,
    webContents: { isDestroyed: () => state.contentsGone === true, send },
  }
  return { window, send }
}

describe('createEventSender', () => {
  it('sends the event to the main window’s webContents', () => {
    const { window, send } = fakeWindow()
    createEventSender(() => window)('scan:failed', failed)
    expect(send).toHaveBeenCalledWith('scan:failed', failed)
  })

  it('does nothing when there is no main window', () => {
    expect(() => createEventSender(() => null)('scan:failed', failed)).not.toThrow()
  })

  it('skips a destroyed window', () => {
    const { window, send } = fakeWindow({ windowGone: true })
    createEventSender(() => window)('scan:failed', failed)
    expect(send).not.toHaveBeenCalled()
  })

  it('skips a destroyed webContents', () => {
    const { window, send } = fakeWindow({ contentsGone: true })
    createEventSender(() => window)('scan:failed', failed)
    expect(send).not.toHaveBeenCalled()
  })
})
