import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { watchRendererLifecycle } from './renderer-lifecycle'

function setup() {
  const contents = new EventEmitter()
  const gone = vi.fn()
  watchRendererLifecycle(contents, gone)
  return { contents, gone }
}

describe('watchRendererLifecycle', () => {
  it('reports a main-frame navigation or reload', () => {
    const { contents, gone } = setup()
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(gone).toHaveBeenCalledTimes(1)
  })

  it('ignores subframe loads, in-page navigation and plain did-start-loading', () => {
    const { contents, gone } = setup()
    contents.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false })
    contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true })
    contents.emit('did-start-loading')
    expect(gone).not.toHaveBeenCalled()
  })

  it('reports a renderer crash', () => {
    const { contents, gone } = setup()
    contents.emit('render-process-gone', {}, { reason: 'crashed' })
    expect(gone).toHaveBeenCalledTimes(1)
  })
})
