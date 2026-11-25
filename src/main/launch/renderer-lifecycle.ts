/** The part of `webContents` this needs; tests pass an EventEmitter. */
interface NavigationDetails {
  isMainFrame: boolean
  isSameDocument: boolean
}

interface RendererEvents {
  on(event: 'did-start-navigation', listener: (details: NavigationDetails) => void): unknown
  on(event: 'render-process-gone', listener: () => void): unknown
}

/**
 * Tells `onGone` when the page starts over (a main-frame navigation or reload) or its process
 * crashes, so a launch request waits for the page to ask for it again. Subframe loads and
 * in-page navigation do not count: they would park requests forever.
 */
export function watchRendererLifecycle(contents: RendererEvents, onGone: () => void): void {
  contents.on('did-start-navigation', (details: NavigationDetails) => {
    if (details.isMainFrame && !details.isSameDocument) onGone()
  })
  contents.on('render-process-gone', () => onGone())
}
