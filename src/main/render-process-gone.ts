import type { RenderProcessGoneDetails } from 'electron'

export type RenderProcessGoneAction = 'ignore' | 'fail-startup' | 'reload' | 'quit'

export interface RenderProcessGoneInput {
  reason: RenderProcessGoneDetails['reason']
  /** The app has started quitting. */
  quitting: boolean
  /** The window finished its first successful load. */
  loaded: boolean
  /** The window was already reloaded once after a renderer crash. */
  reloadedAfterCrash: boolean
}

export const RENDERER_GONE_TITLE = 'StorageIQ stopped unexpectedly'
export const RENDERER_GONE_RELOAD_MESSAGE =
  'StorageIQ ran into a problem and will reload its window. Any scan in progress was stopped.'
export const RENDERER_GONE_QUIT_MESSAGE =
  'StorageIQ ran into the same problem again and will close. Please open it again.'

/** Spec §4 / roadmap carry-over 5. */
export function decideRenderProcessGone(input: RenderProcessGoneInput): RenderProcessGoneAction {
  if (input.reason === 'clean-exit' || input.quitting) return 'ignore'
  if (!input.loaded) return 'fail-startup'
  return input.reloadedAfterCrash ? 'quit' : 'reload'
}
