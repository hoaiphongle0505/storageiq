import type { ScanError, ScanErrorReason } from '@shared/scan-types'
import { formatCount } from '../lib/format'

export const REASON_TEXT: Record<Exclude<ScanErrorReason, 'other'>, string> = {
  'access-denied': 'Windows didn’t give StorageIQ permission to open it.',
  'path-too-long': 'Its path is too long for Windows to open.',
  'not-found': 'It was moved or deleted during the scan.',
}

function reasonText(error: ScanError): string {
  return error.reason === 'other'
    ? `Windows reported an error (${error.code}).`
    : REASON_TEXT[error.reason]
}

export function UnreadableList({
  errors,
  errorCount,
}: {
  errors: ScanError[]
  errorCount: number
}) {
  return (
    <details className="rounded-panel border border-line bg-panel px-4 py-3">
      <summary className="cursor-pointer font-medium">
        {errorCount === 1
          ? '1 folder couldn’t be read'
          : `${formatCount(errorCount)} folders couldn’t be read`}
      </summary>
      <ul className="mt-3 flex flex-col gap-2">
        {errors.map((error, index) => (
          <li key={`${index}:${error.path}`}>
            <p className="font-mono text-[13px] break-all">{error.path}</p>
            <p className="text-ink-muted">{reasonText(error)}</p>
          </li>
        ))}
      </ul>
      {errorCount > errors.length && (
        <p className="mt-3 text-ink-muted">Showing the first {formatCount(errors.length)}.</p>
      )}
    </details>
  )
}
