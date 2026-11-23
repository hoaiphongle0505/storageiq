import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { Button } from './Button'

/**
 * A modal `<dialog>` (modern-web-guidance "html": native dialog, focus moves in and returns,
 * Escape closes). Shown with `showModal()`; jsdom has no `showModal`, so tests get `open`.
 */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string
  onClose(): void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // Captured during the first render, before the dialog moves focus (and once under StrictMode).
  const [opener] = useState<Element | null>(() => document.activeElement)

  useEffect(() => {
    const dialog = ref.current
    if (dialog === null) return
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal()
    } else {
      dialog.setAttribute('open', '')
    }
    return () => {
      // If the opener went away, fall back to the ribbon tab that is selected.
      const target =
        opener instanceof HTMLElement && opener.isConnected
          ? opener
          : document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      target?.focus()
    }
  }, [opener])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className="m-auto w-[min(40rem,90vw)] rounded-panel border border-line bg-panel p-0 text-ink shadow-menu backdrop:bg-black/30"
    >
      <div className="flex max-h-[70vh] flex-col gap-3 p-5">
        <h2 id={titleId} className="font-display text-lg font-semibold">
          {title}
        </h2>
        <div className="min-h-0 overflow-auto">{children}</div>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose} autoFocus>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  )
}
