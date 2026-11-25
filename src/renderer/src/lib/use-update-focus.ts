import { type RefObject, useEffect, useRef } from 'react'

/**
 * Keeps keyboard focus from falling to <body> when the Update button the user just pressed is
 * removed. Call the returned function from the Update click. When the state then becomes
 * `downloading` or `checking`, focus moves to `region` (a tabIndex -1 element that stays
 * mounted); when it becomes `ready`, focus moves to `restart`. Focus is only moved if it is still in the region or
 * lost, so it never steals focus the user has moved elsewhere.
 */
export function useUpdateFocus(
  kind: string,
  region: RefObject<HTMLElement | null>,
  restart: RefObject<HTMLElement | null>,
): () => void {
  const pending = useRef(false)
  useEffect(() => {
    if (!pending.current) return
    const active = document.activeElement
    const mine = active === document.body || active === null || region.current?.contains(active)
    if (kind === 'downloading' || kind === 'checking') {
      if (mine) region.current?.focus()
    } else {
      if (kind === 'ready' && mine) restart.current?.focus()
      pending.current = false
    }
  }, [kind, region, restart])
  return () => {
    pending.current = true
  }
}
