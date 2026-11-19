import { useEffect, useId, useRef } from 'react'
import { useScanStore } from '../stores/scan-store-context'
import { Button } from './Button'

export function CrashScreen() {
  const rescan = useScanStore((s) => s.rescan)
  const chooseAnotherLocation = useScanStore((s) => s.chooseAnotherLocation)
  const headingId = useId()
  const retryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    retryRef.current?.focus()
  }, [])

  return (
    <section
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-xl flex-col items-start gap-4 px-8 py-16"
    >
      <h1 id={headingId} className="font-display text-2xl font-semibold tracking-tight">
        The scan stopped unexpectedly. You can try again.
      </h1>
      <div className="flex gap-2">
        <Button ref={retryRef} onClick={() => void rescan()}>
          Retry
        </Button>
        <Button variant="secondary" onClick={chooseAnotherLocation}>
          Choose another location
        </Button>
      </div>
    </section>
  )
}
