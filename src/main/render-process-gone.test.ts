import { describe, expect, it } from 'vitest'
import {
  decideRenderProcessGone,
  type RenderProcessGoneAction,
  type RenderProcessGoneInput,
} from './render-process-gone'

const base: RenderProcessGoneInput = {
  reason: 'crashed',
  quitting: false,
  loaded: true,
  reloadedAfterCrash: false,
}

describe('decideRenderProcessGone', () => {
  it.each<[string, Partial<RenderProcessGoneInput>, RenderProcessGoneAction]>([
    ['a clean exit', { reason: 'clean-exit' }, 'ignore'],
    ['a crash while quitting', { quitting: true }, 'ignore'],
    [
      'a kill while quitting, even before the first load',
      { reason: 'killed', quitting: true, loaded: false },
      'ignore',
    ],
    ['a crash before the first load', { loaded: false }, 'fail-startup'],
    ['a launch failure', { reason: 'launch-failed', loaded: false }, 'fail-startup'],
    ['the first crash after the first load', {}, 'reload'],
    ['an out-of-memory kill after the first load', { reason: 'oom' }, 'reload'],
    ['a second crash after the reload', { reloadedAfterCrash: true }, 'quit'],
  ])('%s', (_label, overrides, expected) => {
    expect(decideRenderProcessGone({ ...base, ...overrides })).toBe(expected)
  })
})
