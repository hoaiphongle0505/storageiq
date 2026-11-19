import type { IpcEventChannel, IpcEventPayload, Unsubscribe } from '@shared/ipc-contract'

/** The part of `ipcRenderer` that `subscribe` needs; tests pass a fake. */
export interface IpcEventSource {
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

/**
 * Subscribes to one main → renderer event. The renderer's callback receives only the payload,
 * never the `IpcRendererEvent` (which would leak `sender` and `ports`).
 */
export function subscribe<E extends IpcEventChannel>(
  source: IpcEventSource,
  channel: E,
  listener: (payload: IpcEventPayload<E>) => void,
): Unsubscribe {
  const forward = (_event: unknown, payload: unknown) => {
    listener(payload as IpcEventPayload<E>)
  }
  source.on(channel, forward)
  return () => {
    source.removeListener(channel, forward)
  }
}
