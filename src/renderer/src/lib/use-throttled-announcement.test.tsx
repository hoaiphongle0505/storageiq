// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ANNOUNCE_INTERVAL_MS, useThrottledAnnouncement } from './use-throttled-announcement'

afterEach(() => {
  vi.useRealTimers()
})

describe('useThrottledAnnouncement', () => {
  it('shows the first text at once, then the latest text at most every 5 seconds', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ text }) => useThrottledAnnouncement(text, ANNOUNCE_INTERVAL_MS),
      { initialProps: { text: 'first' } },
    )
    expect(ANNOUNCE_INTERVAL_MS).toBe(5_000)
    expect(result.current).toBe('first')

    rerender({ text: 'second' })
    rerender({ text: 'third' })
    act(() => {
      vi.advanceTimersByTime(4_999)
    })
    expect(result.current).toBe('first')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe('third')
  })

  it('stops its timer when unmounted', () => {
    vi.useFakeTimers()
    const { unmount } = renderHook(() => useThrottledAnnouncement('text', ANNOUNCE_INTERVAL_MS))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
