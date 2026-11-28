/** The least a non-empty slice turns, so a sliver of 0.01 % is still drawn. */
export const MIN_SLICE_DEGREES = 1

export interface PieSlice {
  /** Position of the value in the input array. */
  index: number
  /** Fraction of the total, 0 to 1. */
  share: number
  /** Degrees clockwise from 12 o'clock. */
  startDeg: number
  endDeg: number
}

/**
 * The slices of a pie for `values`, in input order (sort first for "largest first"), starting at
 * 12 o'clock and going clockwise. Zero (and negative) values get no slice. The slices fill exactly
 * 360°, and no slice turns less than 1°: tiny ones are widened and the others give up the
 * difference.
 */
export function pieSlices(values: readonly number[]): PieSlice[] {
  const entries = values.flatMap((value, index) => (value > 0 ? [{ index, value }] : []))
  const total = entries.reduce((sum, entry) => sum + entry.value, 0)
  if (total === 0) return []
  const clamped = new Set<number>()
  let scale = 1
  // Widening a slice shrinks the rest, which can push another one under 1°: repeat until stable.
  for (;;) {
    const free = entries.filter((entry) => !clamped.has(entry.index))
    const freeDegrees = 360 - clamped.size * MIN_SLICE_DEGREES
    const freeValue = free.reduce((sum, entry) => sum + entry.value, 0)
    scale = freeValue > 0 ? freeDegrees / freeValue : 0
    const small = free.filter((entry) => entry.value * scale < MIN_SLICE_DEGREES)
    if (small.length === 0) break
    for (const entry of small) clamped.add(entry.index)
  }
  let angle = 0
  return entries.map((entry, position) => {
    const degrees = clamped.has(entry.index) ? MIN_SLICE_DEGREES : entry.value * scale
    const startDeg = angle
    angle = position === entries.length - 1 ? 360 : angle + degrees
    return { index: entry.index, share: entry.value / total, startDeg, endDeg: angle }
  })
}

const round = (n: number) => Math.round(n * 100) / 100

/** The point at `deg` clockwise from 12 o'clock on a circle around (cx, cy). */
function point(cx: number, cy: number, radius: number, deg: number): string {
  const radians = (deg * Math.PI) / 180
  return `${round(cx + radius * Math.sin(radians))} ${round(cy - radius * Math.cos(radians))}`
}

/**
 * The SVG path of a donut slice between two angles. A slice of the whole circle is drawn as two
 * half turns, because one arc cannot start and end on the same point.
 */
export function donutPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startDeg: number,
  endDeg: number,
): string {
  if (endDeg - startDeg >= 360 - 1e-6) {
    const mid = startDeg + 180
    return (
      `M ${point(cx, cy, outer, startDeg)} A ${outer} ${outer} 0 1 1 ${point(cx, cy, outer, mid)} ` +
      `A ${outer} ${outer} 0 1 1 ${point(cx, cy, outer, startDeg)} ` +
      `M ${point(cx, cy, inner, startDeg)} A ${inner} ${inner} 0 1 0 ${point(cx, cy, inner, mid)} ` +
      `A ${inner} ${inner} 0 1 0 ${point(cx, cy, inner, startDeg)} Z`
    )
  }
  const large = endDeg - startDeg > 180 ? 1 : 0
  return (
    `M ${point(cx, cy, outer, startDeg)} A ${outer} ${outer} 0 ${large} 1 ${point(cx, cy, outer, endDeg)} ` +
    `L ${point(cx, cy, inner, endDeg)} A ${inner} ${inner} 0 ${large} 0 ${point(cx, cy, inner, startDeg)} Z`
  )
}

/** Each bar's length as a fraction (0 to 1) of the longest bar; all zero when nothing is positive. */
export function barLengths(values: readonly number[]): number[] {
  const longest = Math.max(0, ...values)
  return values.map((value) => (longest > 0 && value > 0 ? value / longest : 0))
}
