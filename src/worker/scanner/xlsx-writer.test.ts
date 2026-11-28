import { randomBytes } from 'node:crypto'
import { crc32, inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { writeXlsx, XLSX_MAX_ROWS, ZIP_TOO_LARGE_MESSAGE, ZipWriter } from './xlsx-writer'

/** Reads a ZIP the way a reader does: the central directory, then each entry's bytes. */
function unzip(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(end).toBeGreaterThanOrEqual(0)
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, string>()
  for (let i = 0; i < count; i += 1) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const flags = zip.readUInt16LE(at + 8)
    expect(flags & 0x0808).toBe(0x0808) // data descriptor and UTF-8 names
    const crc = zip.readUInt32LE(at + 16)
    const compressed = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressed))
    expect(data.length).toBe(size)
    expect(crc32(data)).toBe(crc)
    // The descriptor right after the data repeats the numbers.
    expect(zip.readUInt32LE(dataStart + compressed)).toBe(0x08074b50)
    expect(zip.readUInt32LE(dataStart + compressed + 4)).toBe(crc)
    files.set(name, data.toString('utf8'))
    at += 46 + nameLength
  }
  return files
}

function collect() {
  const chunks: Buffer[] = []
  return { write: (chunk: Buffer) => void chunks.push(chunk), bytes: () => Buffer.concat(chunks) }
}

describe('ZipWriter', () => {
  it('writes entries a ZIP reader accepts, with correct sizes and checksums', async () => {
    const out = collect()
    const zip = new ZipWriter(out.write)
    await zip.addEntry('a.txt', async (push) => {
      await push('hello ')
      await push('wörld')
    })
    await zip.addEntry('dir/b.txt', (push) => push('x'.repeat(100_000)))
    await zip.finish()
    const files = unzip(out.bytes())
    expect([...files.keys()]).toEqual(['a.txt', 'dir/b.txt'])
    expect(files.get('a.txt')).toBe('hello wörld')
    expect(files.get('dir/b.txt')).toBe('x'.repeat(100_000))
  })

  it('fails clearly instead of writing a ZIP past its size limit (no ZIP64)', async () => {
    const zip = new ZipWriter(() => undefined, 200)
    // Random text does not compress, so the output really passes the limit.
    const noise = randomBytes(2000).toString('hex')
    await expect(zip.addEntry('big.txt', (push) => push(noise))).rejects.toThrow(
      ZIP_TOO_LARGE_MESSAGE,
    )
  })

  it('passes on an error from the writer', async () => {
    const zip = new ZipWriter(() => {
      throw new Error('disk full')
    })
    await expect(zip.addEntry('a.txt', (push) => push('x'))).rejects.toThrow('disk full')
  })
})

describe('writeXlsx', () => {
  const date = new Date(Date.UTC(2026, 10, 19, 12))

  it('writes the parts of a workbook and one worksheet per spec, in order', async () => {
    const out = collect()
    const results = await writeXlsx(out.write, [
      { name: 'Tree', header: ['Path'], widths: [40], rows: [['C:\\a']] },
      { name: 'Age', header: ['Age', 'Files'], widths: [20, 10], rows: [] },
    ])
    expect(results).toEqual([
      { rows: 1, truncated: false },
      { rows: 0, truncated: false },
    ])
    const files = unzip(out.bytes())
    expect([...files.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ])
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Tree" sheetId="1" r:id="rId1"/>')
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Age" sheetId="2" r:id="rId2"/>')
    expect(files.get('[Content_Types].xml')).toContain('/xl/worksheets/sheet2.xml')
    expect(files.get('xl/_rels/workbook.xml.rels')).toContain('Target="styles.xml"')
  })

  it('freezes and bolds the header and stores numbers and dates as numbers', async () => {
    const out = collect()
    await writeXlsx(out.write, [
      {
        name: 'Tree',
        header: ['Name', 'Size', 'Modified', 'Share'],
        widths: [30, 12, 20, 10],
        rows: [['a.txt', 1536, date, 12.5]],
      },
    ])
    const sheet = unzip(out.bytes()).get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain(
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>',
    )
    expect(sheet).toContain('<col min="1" max="1" width="30" customWidth="1"/>')
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t>Name</t></is></c>')
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>a.txt</t></is></c>')
    expect(sheet).toContain('<c r="B2" s="3"><v>1536</v></c>')
    expect(sheet).toContain(
      `<c r="C2" s="2"><v>${Date.UTC(2026, 10, 19, 12) / 86_400_000 + 25_569}</v></c>`,
    )
    expect(sheet).toContain('<c r="D2"><v>12.5</v></c>')
    expect(unzip(out.bytes()).get('xl/styles.xml')).toContain('yyyy\\-mm\\-dd\\ hh:mm:ss')
  })

  it('never writes a formula: text is an inline string, escaped, and empty cells are skipped', async () => {
    const out = collect()
    await writeXlsx(out.write, [
      {
        name: 'Tree',
        header: ['A', 'B', 'C'],
        widths: [10, 10, 10],
        rows: [['=1+1 & <b>', null, ' padded \u0001']],
      },
    ])
    const sheet = unzip(out.bytes()).get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t>=1+1 &amp; &lt;b&gt;</t></is></c>')
    expect(sheet).not.toContain('<f>')
    expect(sheet).not.toContain('r="B2"')
    expect(sheet).toContain('<t xml:space="preserve"> padded </t>')
  })

  it('names columns past Z like a spreadsheet does', async () => {
    const out = collect()
    const header = Array.from({ length: 28 }, (_, i) => `h${i}`)
    await writeXlsx(out.write, [{ name: 'Wide', header, widths: [], rows: [] }])
    const sheet = unzip(out.bytes()).get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain('r="Z1"')
    expect(sheet).toContain('r="AA1"')
    expect(sheet).toContain('r="AB1"')
  })

  it('stops at the row limit and says so, but not when the rows just fit', async () => {
    expect(XLSX_MAX_ROWS).toBe(1_048_575)
    const rows = [['1'], ['2'], ['3']]
    const full = collect()
    const [fits] = await writeXlsx(full.write, [
      { name: 'T', header: ['n'], widths: [5], rows, maxRows: 3 },
    ])
    expect(fits).toEqual({ rows: 3, truncated: false })
    const cut = collect()
    const [short] = await writeXlsx(cut.write, [
      { name: 'T', header: ['n'], widths: [5], rows, maxRows: 2 },
    ])
    expect(short).toEqual({ rows: 2, truncated: true })
    const sheet = unzip(cut.bytes()).get('xl/worksheets/sheet1.xml') ?? ''
    expect(sheet).toContain('<row r="3">')
    expect(sheet).not.toContain('<row r="4">')
  })
})
