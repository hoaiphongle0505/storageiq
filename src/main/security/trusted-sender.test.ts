import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { describe, expect, it } from 'vitest'
import { isTrustedIpcSender } from './trusted-sender'

const mainContents = {} as WebContents
const isTrustedUrl = (url: string) => url === 'app://trusted/index.html'

function eventFrom(
  sender: WebContents,
  senderFrame: { url: string; parent: unknown } | null,
): IpcMainInvokeEvent {
  return { sender, senderFrame } as unknown as IpcMainInvokeEvent
}

const options = { mainWebContents: mainContents, isTrustedUrl }

describe('isTrustedIpcSender', () => {
  it('accepts the top frame of the main window at a trusted url', () => {
    const event = eventFrom(mainContents, { url: 'app://trusted/index.html', parent: null })
    expect(isTrustedIpcSender(event, options)).toBe(true)
  })

  it('rejects a subframe', () => {
    const event = eventFrom(mainContents, { url: 'app://trusted/index.html', parent: {} })
    expect(isTrustedIpcSender(event, options)).toBe(false)
  })

  it('rejects a different webContents', () => {
    const event = eventFrom({} as WebContents, { url: 'app://trusted/index.html', parent: null })
    expect(isTrustedIpcSender(event, options)).toBe(false)
  })

  it('rejects a null senderFrame', () => {
    expect(isTrustedIpcSender(eventFrom(mainContents, null), options)).toBe(false)
  })

  it('rejects an untrusted url', () => {
    const event = eventFrom(mainContents, { url: 'https://evil.example/', parent: null })
    expect(isTrustedIpcSender(event, options)).toBe(false)
  })

  it('rejects everything when there is no main window', () => {
    const event = eventFrom(mainContents, { url: 'app://trusted/index.html', parent: null })
    expect(isTrustedIpcSender(event, { mainWebContents: null, isTrustedUrl })).toBe(false)
  })
})
