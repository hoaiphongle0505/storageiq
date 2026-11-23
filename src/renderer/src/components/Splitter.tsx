import { type KeyboardEvent, type PointerEvent, useRef } from 'react'

export const SPLITTER_STEP = 16

/**
 * Horizontal splitter between the tree and the treemap: a focusable `separator` with a value
 * (WAI-ARIA window splitter). Drag with the pointer, or use ↑ ↓ (16 px), Home (smallest) and End (largest).
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
            ? min
            : event.key === 'End'
              ? max
              : null
    if (next === null) return
    event.preventDefault()
    onChange(clamp(next))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    drag.current = { startY: event.clientY, startValue: value }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return
    onChange(clamp(drag.current.startValue + (drag.current.startY - event.clientY)))
  }
  const endDrag = () => {
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
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      className="group relative h-(--size-splitter) shrink-0 cursor-row-resize touch-none bg-app outline-none before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-line hover:before:bg-line-strong focus-visible:before:h-0.5 focus-visible:before:bg-accent active:before:h-0.5 active:before:bg-accent after:absolute after:top-1/2 after:left-1/2 after:h-1 after:w-8 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-pill after:bg-line-strong focus-visible:after:bg-accent active:after:bg-accent"
    />
  )
}
