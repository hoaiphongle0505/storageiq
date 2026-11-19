import type { IpcEventChannel, IpcEventPayload } from '@shared/ipc-contract'

/** The part of a `BrowserWindow` that `sendEvent` needs; tests pass a fake. */
export interface EventWindow {
  isDestroyed(): boolean
  webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void }
}

export type SendEvent = <E extends IpcEventChannel>(channel: E, payload: IpcEventPayload<E>) => void

/**
 * Main → renderer events go to the main window only. When the window (or its webContents) is
 * gone, the event is dropped instead of throwing.
 */
export function createEventSender(getMainWindow: () => EventWindow | null): SendEvent {
  return (channel, payload) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
    window.webContents.send(channel, payload)
  }
}
