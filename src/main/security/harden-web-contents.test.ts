import { EventEmitter } from 'node:events'
import type { App, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { hardenWebContents } from './harden-web-contents'

const TRUSTED = 'file:///app/renderer/index.html'
const UNTRUSTED = 'https://evil.example/'

function setup() {
  const fakeApp = new EventEmitter()
  const contents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
  hardenWebContents(fakeApp as unknown as Pick<App, 'on'>, (url) => url === TRUSTED)
  fakeApp.emit('web-contents-created', {}, contents as unknown as WebContents)
  return contents
}

describe('hardenWebContents', () => {
  it.each(['will-navigate', 'will-frame-navigate', 'will-redirect'])(
    'blocks untrusted and allows trusted URLs on %s',
    (eventName) => {
      const contents = setup()

      const blocked = { url: UNTRUSTED, preventDefault: vi.fn() }
      contents.emit(eventName, blocked)
      expect(blocked.preventDefault).toHaveBeenCalledTimes(1)

      const allowed = { url: TRUSTED, preventDefault: vi.fn() }
      contents.emit(eventName, allowed)
      expect(allowed.preventDefault).not.toHaveBeenCalled()
    },
  )

  it('denies every window.open request', () => {
    const contents = setup()
    const handler = contents.setWindowOpenHandler.mock.calls[0]?.[0] as () => unknown
    expect(handler()).toEqual({ action: 'deny' })
  })

  it('prevents attaching a webview', () => {
    const contents = setup()
    const event = { preventDefault: vi.fn() }
    contents.emit('will-attach-webview', event)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
  })
})
