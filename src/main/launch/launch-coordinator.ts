import type { LaunchRequest } from '@shared/ipc-contract'
import { type LaunchStat, resolveLaunchRequest } from './launch-args'

export interface LaunchCoordinator {
  /** First launch and second-instance both call this with the process’s full argv. */
  handleArgv(argv: readonly string[]): Promise<void>
  /** `launch:take-request`: returns and clears the pending request; marks the renderer ready. */
  take(): LaunchRequest | null
  /** Renderer reloaded or navigated: pending requests wait again. */
  rendererGone(): void
}

export function createLaunchCoordinator(deps: {
  stat: LaunchStat
  send(request: LaunchRequest): void // main → renderer event
  focus(): void
}): LaunchCoordinator {
  let ready = false
  let pending: LaunchRequest | null = null
  return {
    async handleArgv(argv) {
      const request = await resolveLaunchRequest(argv, deps.stat)
      if (request === null) return
      if (ready) {
        deps.send(request)
        deps.focus()
      } else {
        pending = request // the latest request replaces an older one
      }
    },
    take() {
      ready = true
      const request = pending
      pending = null
      return request
    },
    rendererGone() {
      ready = false
    },
  }
}
