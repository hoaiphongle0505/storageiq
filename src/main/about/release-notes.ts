const MAX_TEXT_CHARS = 20_000

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
}

function convert(html: string): string {
  return html
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(?:p|li|ul|h[1-6])\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_match, name: string) => ENTITIES[name] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Plain text for electron-updater's `releaseNotes` (a string, an array of `{ version, note }` or
 * null). Tags are removed and the result is only ever shown as a text node.
 */
export function htmlToPlainText(notes: unknown): string | null {
  let source: string | null = null
  if (typeof notes === 'string') {
    source = convert(notes)
  } else if (Array.isArray(notes)) {
    const parts: string[] = []
    for (const item of notes as unknown[]) {
      const note = (item as { note?: unknown } | null)?.note
      if (typeof note === 'string') parts.push(convert(note))
    }
    source = parts.filter((part) => part !== '').join('\n\n')
  }
  if (source === null) return null
  const text = source.slice(0, MAX_TEXT_CHARS).trim()
  return text === '' ? null : text
}
