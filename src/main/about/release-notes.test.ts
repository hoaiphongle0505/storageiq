import { describe, expect, it } from 'vitest'
import { htmlToPlainText } from './release-notes'

describe('htmlToPlainText', () => {
  it('converts list items and paragraphs to plain lines', () => {
    expect(htmlToPlainText('<p>Intro</p><ul><li>One</li><li>Two</li></ul>')).toBe(
      'Intro\n- One\n- Two',
    )
    expect(htmlToPlainText('<h2>Title</h2>a<br>b')).toBe('Title\na\nb')
  })

  it('removes every tag including script and style tags', () => {
    const text = htmlToPlainText('<script>alert(1)</script><style>p{}</style><b>ok</b><img src=x>')
    expect(text).not.toContain('<')
    expect(text).toContain('ok')
  })

  it('decodes the common entities once', () => {
    expect(htmlToPlainText('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;&nbsp;f')).toBe(
      'a & b <c> "d" \'e\' f',
    )
    expect(htmlToPlainText('&amp;lt;')).toBe('&lt;')
  })

  it('joins an array of notes and ignores versions', () => {
    expect(
      htmlToPlainText([
        { version: '1.0.0', note: '<p>First</p>' },
        { version: '1.1.0', note: 'Second' },
        { version: '1.2.0', note: null },
      ]),
    ).toBe('First\n\nSecond')
  })

  it('returns null for null, numbers and empty results', () => {
    expect(htmlToPlainText(null)).toBeNull()
    expect(htmlToPlainText(5)).toBeNull()
    expect(htmlToPlainText('<p> </p>')).toBeNull()
    expect(htmlToPlainText([])).toBeNull()
  })

  it('cuts the text at 20000 characters', () => {
    expect(htmlToPlainText('a'.repeat(25_000))?.length).toBe(20_000)
  })
})
