import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions } from '@shared/semver'
import {
  MAX_CHANGELOG_CHARS,
  MAX_ENTRIES,
  MAX_ITEM_CHARS,
  MAX_ITEMS,
  MAX_SECTIONS,
  MAX_TITLE_CHARS,
  parseChangelog,
} from './parse-changelog'

describe('parseChangelog', () => {
  it('parses entries, dates and sections in file order', () => {
    const entries = parseChangelog(
      '# Changelog\n\n## [0.2.0] - 2026-11-25\n\n### Added\n\n- One\n- Two\n\n### Fixed\n\n- Three\n\n## [0.1.0]\n\n### Added\n\n- Old\n',
    )
    expect(entries).toEqual([
      {
        version: '0.2.0',
        date: '2026-11-25',
        sections: [
          { title: 'Added', items: ['One', 'Two'] },
          { title: 'Fixed', items: ['Three'] },
        ],
      },
      { version: '0.1.0', date: null, sections: [{ title: 'Added', items: ['Old'] }] },
    ])
  })

  it('joins wrapped bullet lines', () => {
    const [entry] = parseChangelog('## [1.0.0]\n### Added\n- A long\n  wrapped line\n- Next\n')
    expect(entry?.sections[0]?.items).toEqual(['A long wrapped line', 'Next'])
  })

  it('puts bullets without a section under Changes', () => {
    const [entry] = parseChangelog('## [1.0.0]\n- Plain\n')
    expect(entry?.sections).toEqual([{ title: 'Changes', items: ['Plain'] }])
  })

  it('skips Unreleased and invalid versions', () => {
    const entries = parseChangelog('## [Unreleased]\n- x\n## [v1.0.0]\n- y\n## [1.0.0]\n- z\n')
    expect(entries.map((e) => e.version)).toEqual(['1.0.0'])
    expect(entries[0]?.sections[0]?.items).toEqual(['z'])
  })

  it('drops empty sections and entries', () => {
    const entries = parseChangelog('## [2.0.0]\n### Added\n### Fixed\n- a\n## [1.0.0]\n### Added\n')
    expect(entries).toEqual([
      { version: '2.0.0', date: null, sections: [{ title: 'Fixed', items: ['a'] }] },
    ])
  })

  it('accepts CRLF line endings', () => {
    const entries = parseChangelog('## [1.0.0] - 2026-01-02\r\n### Added\r\n- a\r\n- b\r\n')
    expect(entries[0]?.sections[0]?.items).toEqual(['a', 'b'])
    expect(entries[0]?.date).toBe('2026-01-02')
  })

  it('returns an empty list for empty, binary or malformed input without throwing', () => {
    expect(parseChangelog('')).toEqual([])
    expect(parseChangelog('\u0000\u0001￿'.repeat(100))).toEqual([])
    expect(parseChangelog('## [1.0.0')).toEqual([])
    expect(parseChangelog(undefined as unknown as string)).toEqual([])
  })

  it('applies the entry, section, item and length limits', () => {
    const entries = Array.from({ length: 60 }, (_, i) => `## [1.0.${i}]\n- a\n`).join('')
    expect(parseChangelog(entries)).toHaveLength(MAX_ENTRIES)

    const sections = Array.from({ length: 20 }, (_, i) => `### S${i}\n- a\n`).join('')
    expect(parseChangelog(`## [1.0.0]\n${sections}`)[0]?.sections).toHaveLength(MAX_SECTIONS)

    const items = Array.from({ length: 60 }, (_, i) => `- i${i}\n`).join('')
    expect(parseChangelog(`## [1.0.0]\n### A\n${items}`)[0]?.sections[0]?.items).toHaveLength(
      MAX_ITEMS,
    )

    const long = parseChangelog(`## [1.0.0]\n### ${'t'.repeat(100)}\n- ${'x'.repeat(500)}\n`)[0]
      ?.sections[0]
    expect(long?.title).toHaveLength(MAX_TITLE_CHARS)
    expect(long?.items[0]).toHaveLength(MAX_ITEM_CHARS)

    const big = `## [1.0.0]\n- a\n${'z'.repeat(MAX_CHANGELOG_CHARS)}\n## [0.9.0]\n- b\n`
    expect(parseChangelog(big).map((e) => e.version)).toEqual(['1.0.0'])
  })

  it('keeps HTML and Markdown characters as plain text', () => {
    const [entry] = parseChangelog('## [1.0.0]\n### Added\n- <b>bold</b> **x** [l](http://a)\n')
    expect(entry?.sections[0]?.items[0]).toBe('<b>bold</b> **x** [l](http://a)')
  })

  it('the real CHANGELOG parses and is not older than package.json', () => {
    const text = readFileSync(resolve('CHANGELOG.md'), 'utf8')
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
    const entries = parseChangelog(text)
    expect(entries.length).toBeGreaterThanOrEqual(1)
    const order = compareVersions(entries[0]?.version ?? '', pkg.version)
    expect(order === 1 || order === 0).toBe(true)
  })
})
