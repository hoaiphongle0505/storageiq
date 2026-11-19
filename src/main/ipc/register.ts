import type { IpcMainInvokeEvent } from 'electron'
import type { IpcArgs, IpcChannel, IpcResult } from '@shared/ipc-contract'

/** One channel: validate the untrusted renderer arguments, then handle the call. */
export interface IpcChannelHandler<C extends IpcChannel> {
  /**
   * Turns raw renderer arguments into the channel's typed arguments. Throws (or rejects with)
   * `InvalidIpcArgumentsError` when they are malformed; `handle` then never runs.
   */
  parseArgs(args: readonly unknown[]): IpcArgs<C> | Promise<IpcArgs<C>>
  handle(event: IpcMainInvokeEvent, ...args: IpcArgs<C>): IpcResult<C> | Promise<IpcResult<C>>
}

/** Exactly one handler for every channel in the contract. */
export type IpcHandlerMap = { [C in IpcChannel]: IpcChannelHandler<C> }

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

interface UntypedChannelHandler {
  parseArgs(args: readonly unknown[]): unknown[] | Promise<unknown[]>
  handle(event: IpcMainInvokeEvent, ...args: unknown[]): unknown
}

export function registerIpcHandlers(
  ipc: IpcRegistrar,
  handlers: IpcHandlerMap,
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): void {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel] as unknown as UntypedChannelHandler
    ipc.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) {
        throw new UntrustedSenderError(channel, event.senderFrame?.url ?? '')
      }
      const parsed = await handler.parseArgs(args)
      return handler.handle(event, ...parsed)
    })
  }
}
