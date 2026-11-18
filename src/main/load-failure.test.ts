import { describe, expect, it } from 'vitest'
import { shouldTreatAsFatalLoadFailure } from './load-failure'

describe('shouldTreatAsFatalLoadFailure', () => {
  it('is fatal for a main-frame failure', () => {
    expect(shouldTreatAsFatalLoadFailure(-105, true)).toBe(true)
  })

  it('ignores subframe failures', () => {
    expect(shouldTreatAsFatalLoadFailure(-105, false)).toBe(false)
  })

  it('ignores ERR_ABORTED (-3)', () => {
    expect(shouldTreatAsFatalLoadFailure(-3, true)).toBe(false)
  })
})
