/**
 * The text of a running download. The percent shown steps in tens (0, 10, 20 … 100), so a
 * polite live region does not announce every tick; the bar itself is exact.
 */
export function downloadingText(version: string, percent: number): string {
  const step = percent >= 100 ? 100 : Math.floor(percent / 10) * 10
  return `Downloading StorageIQ ${version}… ${step}%`
}

export function UpdateProgress({ percent }: { percent: number }) {
  return (
    <progress
      aria-label="Update download"
      value={percent}
      max={100}
      className="h-2 w-40 shrink-0 accent-(--accent)"
    />
  )
}
