import { describe, expect, it, vi } from 'vitest'
import {
  decideRenderProcessGone,
  reloadAfterRendererCrash,
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

describe('reloadAfterRendererCrash', () => {
  it('stops the scan before the dialog, then reloads', () => {
    const calls: string[] = []
    reloadAfterRendererCrash({
      stopScan: () => calls.push('stop'),
      showDialog: () => calls.push('dialog'),
      reload: () => calls.push('reload'),
    })
    expect(calls).toEqual(['stop', 'dialog', 'reload'])
  })

  it('works without a stopScan callback', () => {
    const showDialog = vi.fn()
    const reload = vi.fn()
    reloadAfterRendererCrash({ showDialog, reload })
    expect(showDialog).toHaveBeenCalledOnce()
    expect(reload).toHaveBeenCalledOnce()
  })
})
