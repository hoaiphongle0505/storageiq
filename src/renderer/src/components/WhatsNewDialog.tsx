import { useEffect, useState } from 'react'
import type { ChangelogEntry } from '@shared/ipc-contract'
import { type WhatsNewTarget } from '../stores/workspace-store'
import { useWorkspace } from '../stores/workspace-store-context'
import { Button } from './Button'
import { Dialog } from './Dialog'

const HISTORY_ENTRIES = 10

type Content =
  | { kind: 'loading' }
  | { kind: 'entries'; entries: ChangelogEntry[] }
  | { kind: 'notes'; text: string }
  | { kind: 'page'; message: string }

function entryHeading(entry: ChangelogEntry): string {
  return `Version ${entry.version}${entry.date === null ? '' : ` (${entry.date})`}`
}

function Entry({ entry }: { entry: ChangelogEntry }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-ink">{entryHeading(entry)}</h3>
      {entry.sections.map((section, index) => (
        <div key={index}>
          <h4 className="text-xs font-semibold text-ink-muted">{section.title}</h4>
          <ul className="list-disc pl-5 text-sm text-ink">
            {section.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** Release notes: the bundled changelog (history, installed) or an update's plain-text notes. */
export function WhatsNewDialog({ target }: { target: WhatsNewTarget }) {
  const closeWhatsNew = useWorkspace((s) => s.closeWhatsNew)
  const loadChangelog = useWorkspace((s) => s.loadChangelog)
  const loadReleaseNotes = useWorkspace((s) => s.loadReleaseNotes)
  const openLink = useWorkspace((s) => s.openLink)
  const [content, setContent] = useState<Content>({ kind: 'loading' })

  const kind = target.kind
  const version = target.kind === 'history' ? null : target.version
  useEffect(() => {
    let current = true
    setContent({ kind: 'loading' })
    if (kind === 'update') {
      loadReleaseNotes().then(
        (notes) => {
          if (!current) return
          setContent(
            notes?.text && notes.version === version
              ? { kind: 'notes', text: notes.text }
              : { kind: 'page', message: 'Release notes are on the release page.' },
          )
        },
        () => {
          if (current) {
            setContent({ kind: 'page', message: 'Release notes are on the release page.' })
          }
        },
      )
    } else {
      void loadChangelog().then((entries) => {
        if (!current) return
        if (kind === 'history') {
          setContent({ kind: 'entries', entries: entries.slice(0, HISTORY_ENTRIES) })
          return
        }
        const match = entries.filter((entry) => entry.version === version)
        setContent(
          match.length > 0
            ? { kind: 'entries', entries: match }
            : { kind: 'page', message: 'No release notes are bundled with this version.' },
        )
      })
    }
    return () => {
      current = false
    }
  }, [kind, version, loadChangelog, loadReleaseNotes])

  return (
    <Dialog title="What's new" onClose={closeWhatsNew}>
      <div className="flex flex-col gap-4">
        {content.kind === 'loading' && (
          <p role="status" className="text-sm text-ink-muted">
            Loading…
          </p>
        )}
        {content.kind === 'entries' &&
          content.entries.map((entry) => <Entry key={entry.version} entry={entry} />)}
        {content.kind === 'entries' && content.entries.length === 0 && (
          <p className="text-sm text-ink-muted">No release notes are bundled with this version.</p>
        )}
        {content.kind === 'notes' && (
          <div className="whitespace-pre-wrap text-sm">{content.text}</div>
        )}
        {content.kind === 'page' && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-ink">{content.message}</p>
            <Button variant="secondary" onClick={() => void openLink('releases')}>
              View release page
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  )
}
