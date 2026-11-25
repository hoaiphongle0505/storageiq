import { type ReactNode, useId } from 'react'

/** A captioned group of commands inside the ribbon's toolbar. */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  const captionId = useId()
  return (
    <div role="group" aria-labelledby={captionId} className="flex flex-col gap-0.5">
      <div className="flex items-start gap-0.5 rounded-group border border-line bg-raised p-0.5 shadow-raised">
        {children}
      </div>
      <span id={captionId} className="text-center text-xs leading-4 font-small text-ink-muted">
        {label}
      </span>
    </div>
  )
}
