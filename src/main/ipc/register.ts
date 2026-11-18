import type { IpcMainInvokeEvent } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult } from '@shared/ipc-contract'

export type IpcHandler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>

/** Exactly one handler for every channel in the contract. */
export type IpcHandlerMap = { [C in IpcChannel]: IpcHandler<C> }

/** The part of `ipcMain` this module needs; lets tests pass a fake. */
export interface IpcRegistrar {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void
}

export class UntrustedSenderError extends Error {
  constructor(channel: string, url: string) {
    super(`Blocked IPC call to "${channel}" from untrusted sender ${url || '(unknown)'}`)
    this.name = 'UntrustedSenderError'
  }
}

export function registerIpcHandlers(
  ipc: IpcRegistrar,
  handlers: IpcHandlerMap,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel] as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ipc.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        throw new UntrustedSenderError(channel, event.senderFrame?.url ?? '')
      }
      // Renderer arguments are untrusted: validate them per channel once a channel takes arguments.
      return handler(event, ...args)
    })
  }
}
