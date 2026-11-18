import type { IpcMainInvokeEvent, WebContents } from 'electron'

/** Only the top frame of the main window, at a trusted renderer URL, may call IPC. */
export function isTrustedIpcSender(
  event: IpcMainInvokeEvent,
  options: {
    mainWebContents: WebContents | null | undefined
    isTrustedUrl: (url: string) => boolean
  },
): boolean {
  const frame = event.senderFrame
  if (!frame || !options.mainWebContents) return false
  if (event.sender !== options.mainWebContents) return false
  if (frame.parent !== null) return false
  return options.isTrustedUrl(frame.url)
}
