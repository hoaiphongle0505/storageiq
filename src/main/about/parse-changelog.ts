import type { ChangelogEntry, ChangelogSection } from '@shared/ipc-contract'
import { parseVersion } from '@shared/semver'

export const MAX_CHANGELOG_CHARS = 262_144
export const MAX_ENTRIES = 50
export const MAX_SECTIONS = 12
export const MAX_ITEMS = 40
export const MAX_ITEM_CHARS = 400
export const MAX_TITLE_CHARS = 60

const ENTRY = /^##\s+\[([^\]\s]+)\]\s*(?:-\s*(\d{4}-\d{2}-\d{2}))?\s*$/
const SECTION = /^###\s+(.+?)\s*$/
const BULLET = /^[-*]\s+(.+)$/

/**
 * Parses the Keep a Changelog subset StorageIQ writes. Never throws; text stays verbatim (the
 * renderer only shows it as text nodes). An invalid version, such as `Unreleased`, skips that entry.
 */
export function parseChangelog(text: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  try {
    const lines = String(text).slice(0, MAX_CHANGELOG_CHARS).split(/\r?\n/)
    let entry: ChangelogEntry | null = null
    let skipping = false
    let section: ChangelogSection | null = null
    let lastItem = -1

    for (const line of lines) {
      const heading = ENTRY.exec(line)
      if (heading !== null || /^##\s/.test(line)) {
        section = null
        lastItem = -1
        const version = heading?.[1] ?? ''
        if (heading === null || parseVersion(version) === null || entries.length >= MAX_ENTRIES) {
          entry = null
          skipping = true
          continue
        }
        skipping = false
        entry = { version, date: heading[2] ?? null, sections: [] }
        entries.push(entry)
        continue
      }
      if (skipping || entry === null) continue

      const sectionHeading = SECTION.exec(line)
      if (sectionHeading !== null) {
        lastItem = -1
        section = null
        if (entry.sections.length < MAX_SECTIONS) {
          section = { title: (sectionHeading[1] ?? '').slice(0, MAX_TITLE_CHARS), items: [] }
          entry.sections.push(section)
        }
        continue
      }
      const bullet = BULLET.exec(line)
      if (bullet !== null) {
        if (section === null && entry.sections.length === 0) {
          section = { title: 'Changes', items: [] }
          entry.sections.push(section)
        }
        if (section !== null && section.items.length < MAX_ITEMS) {
          section.items.push((bullet[1] ?? '').trim().slice(0, MAX_ITEM_CHARS))
          lastItem = section.items.length - 1
        } else {
          lastItem = -1
        }
        continue
      }
      if (/^\s{2,}\S/.test(line) && section !== null && lastItem >= 0) {
        const joined = `${section.items[lastItem] ?? ''} ${line.trim()}`
        section.items[lastItem] = joined.slice(0, MAX_ITEM_CHARS)
        continue
      }
      if (line.trim() !== '') lastItem = -1
    }
  } catch {
    // Malformed input yields what was parsed so far.
  }
  return entries
    .map((entry) => ({ ...entry, sections: entry.sections.filter((s) => s.items.length > 0) }))
    .filter((entry) => entry.sections.length > 0)
}
