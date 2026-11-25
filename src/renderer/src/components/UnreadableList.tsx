import type { ScanError, ScanErrorReason } from '@shared/scan-types'
import { formatCount } from '../lib/format'

export const REASON_TEXT: Record<Exclude<ScanErrorReason, 'other'>, string> = {
  'access-denied': 'Windows didn’t give StorageIQ permission to open it.',
  'path-too-long': 'Its path is too long for Windows to open.',
  'not-found': 'It was moved or deleted during the scan.',
}

export function reasonText(error: ScanError): string {
  return error.reason === 'other'
    ? `Windows reported an error (${error.code}).`
    : REASON_TEXT[error.reason]
}

/** "3 folders couldn’t be read", or "items" as soon as a file is among them. */
export function unreadableSummary(errors: readonly ScanError[], errorCount: number): string {
  // Entries beyond the listed ones are unknown, so only a fully folder list keeps the folder wording.
  const allFolders = errors.every((error) => error.kind === 'folder')
  const noun = allFolders ? 'folder' : 'item'
  return errorCount === 1
    ? `1 ${noun} couldn’t be read`
    : `${formatCount(errorCount)} ${noun}s couldn’t be read`
}

/** Every unreadable entry with a plain-language reason (shown in the "excluded" dialog). */
export function UnreadableList({
  errors,
  errorCount,
}: {
  errors: readonly ScanError[]
  errorCount: number
}) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {errors.map((error, index) => (
          <li key={`${index}:${error.path}`}>
            <p className="font-mono text-[13px] break-all">{error.path}</p>
            <p className="text-ink-muted">{reasonText(error)}</p>
          </li>
        ))}
      </ul>
      {errorCount > errors.length && (
        <p className="text-ink-muted">Showing the first {formatCount(errors.length)}.</p>
      )}
    </div>
  )
}
