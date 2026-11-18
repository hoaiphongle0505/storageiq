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
  isTrustedSender: (url: string) => boolean,
): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel] as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ipc.handle(channel, (event, ...args) => {
      const url = event.senderFrame?.url ?? ''
      if (!isTrustedSender(url)) {
        throw new UntrustedSenderError(channel, url)
      }
      return handler(event, ...args)
    })
  }
}
