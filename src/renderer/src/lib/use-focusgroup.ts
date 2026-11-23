import { type RefObject, useEffect } from 'react'

export type FocusgroupKind = 'toolbar' | 'tablist' | 'menu'

/** True when the browser provides `focusgroup` natively (Chromium 150+; Electron 45 has 156). */
export function hasNativeFocusgroup(): boolean {
  return typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype
}

const ITEM_SELECTOR = 'button:not([disabled])'

/**
 * Fallback for the `focusgroup` attribute (modern-web-guidance "toolbar", "tabs" and "menu"):
 * one tab stop (roving `tabindex`), arrow keys move between items and wrap, Home/End jump to
 * the ends. Installed only when native focusgroup is missing (for example in jsdom), so the
 * browser's own behaviour is never doubled. `items` are the container's own buttons, not
 * those of a nested group with its own focusgroup.
 */
export function useFocusgroupFallback(
  ref: RefObject<HTMLElement | null>,
  kind: FocusgroupKind,
  /** Change this when the set of items changes (for example a menu's item count). */
  itemsKey: unknown = null,
): void {
  useEffect(() => {
    const container = ref.current
    if (container === null || hasNativeFocusgroup()) return
    const items = () =>
      [...container.querySelectorAll<HTMLElement>(ITEM_SELECTOR)].filter(
        (item) => item.closest('[focusgroup]') === container,
      )
    const roving = kind !== 'menu'
    // A native focusgroup ignores an item with `tabindex="-1"` (that is its opt-out), so menu
    // items carry none in the markup; only this fallback keeps them out of the Tab order.
    if (!roving) for (const item of items()) item.tabIndex = -1
    if (roving) {
      const all = items()
      const active =
        all.find((item) => item.getAttribute('aria-selected') === 'true') ?? all[0] ?? null
      for (const item of all) item.tabIndex = item === active ? 0 : -1
    }
    const onFocusIn = (event: FocusEvent) => {
      if (!roving) return
      const all = items()
      if (!all.includes(event.target as HTMLElement)) return
      for (const item of all) item.tabIndex = item === event.target ? 0 : -1
    }
    const vertical = kind === 'menu'
    const onKeyDown = (event: KeyboardEvent) => {
      const all = items()
      const current = all.indexOf(document.activeElement as HTMLElement)
      if (current === -1) return
      const step =
        event.key === (vertical ? 'ArrowDown' : 'ArrowRight')
          ? 1
          : event.key === (vertical ? 'ArrowUp' : 'ArrowLeft')
            ? -1
            : 0
      let next = -1
      if (step !== 0) next = (current + step + all.length) % all.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = all.length - 1
      if (next === -1) return
      event.preventDefault()
      all[next]?.focus()
    }
    container.addEventListener('focusin', onFocusIn)
    container.addEventListener('keydown', onKeyDown)
    return () => {
      container.removeEventListener('focusin', onFocusIn)
      container.removeEventListener('keydown', onKeyDown)
    }
  }, [ref, kind, itemsKey])
}
