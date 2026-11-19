// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useScanStore } from './scan-store-context'

function Probe() {
  useScanStore((s) => s.phase)
  return null
}

describe('useScanStore', () => {
  it('throws outside <ScanStoreProvider>', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => render(<Probe />)).toThrow('useScanStore must be used inside <ScanStoreProvider>')
    consoleError.mockRestore()
  })
})
