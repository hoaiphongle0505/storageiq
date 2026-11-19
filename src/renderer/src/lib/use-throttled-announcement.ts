import { useEffect, useRef, useState } from 'react'

/** Screen-reader progress is announced at most this often (spec §1). */
export const ANNOUNCE_INTERVAL_MS = 5_000

/**
 * Returns `text` for an `aria-live` region, updated at most once per `intervalMs`, so frequent
 * progress updates never flood a screen reader.
 */
export function useThrottledAnnouncement(text: string, intervalMs: number): string {
  const [announced, setAnnounced] = useState(text)
  const latest = useRef(text)

  useEffect(() => {
    latest.current = text
  }, [text])

  useEffect(() => {
    const timer = setInterval(() => setAnnounced(latest.current), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return announced
}
