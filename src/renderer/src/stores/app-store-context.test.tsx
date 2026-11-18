// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from './app-store-context'

function Probe() {
  useAppStore((s) => s.scanTarget)
  return null
}

describe('useAppStore', () => {
  it('throws outside <AppStoreProvider>', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow('useAppStore must be used inside <AppStoreProvider>')
    consoleError.mockRestore()
  })
})
