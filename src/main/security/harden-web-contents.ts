import type { App, WebContents } from 'electron'

/**
 * Applied to every webContents: no popups, no webviews, and navigation
 * (including frames and redirects) only to trusted renderer URLs.
 */
export function hardenWebContents(
  app: Pick<App, 'on'>,
  isTrustedUrl: (url: string) => boolean,
): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', (event) => event.preventDefault())

    const blockUntrusted = (event: { url: string; preventDefault(): void }) => {
      if (!isTrustedUrl(event.url)) {
        event.preventDefault()
      }
    }
    contents.on('will-navigate', blockUntrusted)
    contents.on('will-frame-navigate', blockUntrusted)
    contents.on('will-redirect', blockUntrusted)
  })
}
