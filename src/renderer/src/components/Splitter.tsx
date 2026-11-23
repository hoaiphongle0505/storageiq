import { type KeyboardEvent, type PointerEvent, useRef } from 'react'

export const SPLITTER_STEP = 16

/**
 * Horizontal splitter between the tree and the treemap: a focusable `separator` with a value
 * (WAI-ARIA window splitter). Drag with the pointer, or use ↑ ↓ (16 px), Home and End.
 */
export function Splitter({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange(value: number): void
}) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null)
  const clamp = (next: number) => Math.max(min, Math.min(max, Math.round(next)))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowUp'
        ? value + SPLITTER_STEP
        : event.key === 'ArrowDown'
          ? value - SPLITTER_STEP
          : event.key === 'Home'
            ? max
            : event.key === 'End'
              ? min
              : null
    if (next === null) return
    event.preventDefault()
    onChange(clamp(next))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: event.clientY, startValue: value }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return
    onChange(clamp(drag.current.startValue + (drag.current.startY - event.clientY)))
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize treemap"
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="h-(--size-splitter) shrink-0 cursor-row-resize bg-line hover:bg-line-strong focus-visible:bg-accent"
    />
  )
}
