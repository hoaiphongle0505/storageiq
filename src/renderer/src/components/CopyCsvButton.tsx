import { useWorkspace } from '../stores/workspace-store-context'
import { BUTTON_VARIANT_CLASSES } from './Button'

/**
 * "Copy as CSV" in a list view's header. `build` makes the CSV of the whole list when the button
 * is pressed; main puts it on the clipboard and the status bar announces "Copied N rows.". With
 * no rows the button stays reachable but does nothing (`aria-disabled`).
 */
export function CopyCsvButton({ build, rows }: { build(): string; rows: number }) {
  const copyCsv = useWorkspace((s) => s.copyCsv)
  const empty = rows === 0
  return (
    <button
      type="button"
      title="Copy this list to the clipboard as CSV"
      aria-disabled={empty ? 'true' : undefined}
      onClick={() => {
        if (!empty) void copyCsv(build(), rows)
      }}
      className={`h-6 rounded-control px-2 text-[13px] leading-[18px] font-medium transition-colors duration-[120ms] aria-disabled:cursor-default aria-disabled:opacity-60 ${BUTTON_VARIANT_CLASSES.quiet}`}
    >
      Copy as CSV
    </button>
  )
}
