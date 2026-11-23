// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspace } from './workspace-store-context'

function Probe() {
  useWorkspace((s) => s.phase)
  return null
}

describe('useWorkspace', () => {
  it('throws outside <WorkspaceStoreProvider>', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow(
      'useWorkspace must be used inside <WorkspaceStoreProvider>',
    )
    consoleError.mockRestore()
  })
})
