import { once } from 'node:events'
import { crc32, createDeflateRaw } from 'node:zlib'
import type { Cell } from '@shared/csv'

/** Data rows a worksheet holds (Excel's 1,048,576 rows, minus the header). */
export const XLSX_MAX_ROWS = 1_048_575
export const ZIP_TOO_LARGE_MESSAGE =
  'The data is too large for one Excel file. Export to CSV instead.'

/** Sends bytes to the file; resolves when the sink can take more (backpressure). */
export type Write = (chunk: Buffer) => Promise<void> | void

const MAX_U32 = 0xffff_ffff
/** 2020-01-01 00:00 in MS-DOS format; the files carry no meaningful time. */
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1
/** Bit 3: sizes follow the data (streaming). Bit 11: names are UTF-8. */
const FLAGS = 0x0808

interface ZipEntry {
  name: Buffer
  crc: number
  compressed: number
  size: number
  offset: number
}

/**
 * A streaming ZIP writer: each entry is deflated as it is produced and its sizes follow the data
 * (a data descriptor), so a big sheet is never held in memory. No ZIP64: anything past 4 GiB
 * fails with a clear message.
 */
export class ZipWriter {
  private offset = 0
  private readonly entries: ZipEntry[] = []

  constructor(
    private readonly write: Write,
    private readonly limit = MAX_U32,
  ) {}

  private async raw(chunk: Buffer): Promise<void> {
    this.offset += chunk.length
    if (this.offset > this.limit) throw new Error(ZIP_TOO_LARGE_MESSAGE)
    await this.write(chunk)
  }

  /** Adds a file; `fill` pushes its text piece by piece. */
  async addEntry(
    name: string,
    fill: (push: (text: string) => Promise<void>) => Promise<void>,
  ): Promise<void> {
    const nameBytes = Buffer.from(name, 'utf8')
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(FLAGS, 6)
    header.writeUInt16LE(8, 8) // deflate
    header.writeUInt16LE(0, 10)
    header.writeUInt16LE(DOS_DATE, 12)
    header.writeUInt16LE(nameBytes.length, 26)
    const entry: ZipEntry = {
      name: nameBytes,
      crc: 0,
      compressed: 0,
      size: 0,
      offset: this.offset,
    }
    await this.raw(Buffer.concat([header, nameBytes]))

    const deflate = createDeflateRaw({ level: 1 })
    const drained = (async () => {
      for await (const chunk of deflate as AsyncIterable<Buffer>) {
        entry.compressed += chunk.length
        await this.raw(chunk)
      }
    })()
    // Kept so a sink failure is reported instead of the abort it causes in a producer on drain.
    let drainError: unknown = null
    drained.catch((error: unknown) => {
      drainError = error
    })
    try {
      await fill(async (text) => {
        const bytes = Buffer.from(text, 'utf8')
        entry.crc = crc32(bytes, entry.crc)
        entry.size += bytes.length
        if (entry.size > MAX_U32) throw new Error(ZIP_TOO_LARGE_MESSAGE)
        if (!deflate.write(bytes)) await once(deflate, 'drain')
      })
      deflate.end()
      await drained
    } catch (error) {
      deflate.destroy()
      throw drainError ?? error
    }
    const descriptor = Buffer.alloc(16)
    descriptor.writeUInt32LE(0x08074b50, 0)
    descriptor.writeUInt32LE(entry.crc, 4)
    descriptor.writeUInt32LE(entry.compressed, 8)
    descriptor.writeUInt32LE(entry.size, 12)
    await this.raw(descriptor)
    this.entries.push(entry)
  }

  /** Writes the central directory; call once, after the last entry. */
  async finish(): Promise<void> {
    const start = this.offset
    for (const entry of this.entries) {
      const record = Buffer.alloc(46)
      record.writeUInt32LE(0x02014b50, 0)
      record.writeUInt16LE(20, 4)
      record.writeUInt16LE(20, 6)
      record.writeUInt16LE(FLAGS, 8)
      record.writeUInt16LE(8, 10)
      record.writeUInt16LE(0, 12)
      record.writeUInt16LE(DOS_DATE, 14)
      record.writeUInt32LE(entry.crc, 16)
      record.writeUInt32LE(entry.compressed, 20)
      record.writeUInt32LE(entry.size, 24)
      record.writeUInt16LE(entry.name.length, 28)
      record.writeUInt32LE(entry.offset, 42)
      await this.raw(Buffer.concat([record, entry.name]))
    }
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(this.entries.length, 8)
    end.writeUInt16LE(this.entries.length, 10)
    end.writeUInt32LE(this.offset - start, 12)
    end.writeUInt32LE(start, 16)
    await this.raw(end)
  }
}

// ---- Worksheets --------------------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

/** Cell styles (`cellXfs` in `styles.xml`). */
const STYLE_BOLD = 1
const STYLE_DATE = 2
const STYLE_INTEGER = 3

/** Characters XML 1.0 cannot hold are dropped; the markup characters are escaped. */
// eslint-disable-next-line no-control-regex -- the control characters are exactly what is removed
const XML_UNSAFE = /[&<>\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }
const escapeXml = (text: string) => text.replace(XML_UNSAFE, (char) => ESCAPES[char] ?? '')

/** Excel's longest cell text. */
const MAX_CELL_CHARS = 32_767
/** Days from 1899-12-30 (Excel's day 0) to 1970-01-01. */
const EXCEL_EPOCH_DAYS = 25_569

const columnNames: string[] = []
/** `A`, `B`, … `Z`, `AA`, … (remembered: a million rows ask for the same few). */
function columnName(index: number): string {
  let name = columnNames[index]
  if (name === undefined) {
    name = ''
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
      name = String.fromCharCode(65 + ((n - 1) % 26)) + name
    }
    columnNames[index] = name
  }
  return name
}

function textCell(ref: string, text: string, style: number): string {
  const clipped = escapeXml(text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS) : text)
  const space = /^\s|\s$/.test(clipped) ? ' xml:space="preserve"' : ''
  const s = style === 0 ? '' : ` s="${style}"`
  return `<c r="${ref}" t="inlineStr"${s}><is><t${space}>${clipped}</t></is></c>`
}

/** Text is an inline string (never a formula); numbers and dates are stored as numbers. */
function cellXml(ref: string, cell: Cell): string {
  if (cell === null) return ''
  if (typeof cell === 'string') return textCell(ref, cell, 0)
  if (cell instanceof Date) {
    const days = cell.getTime() / 86_400_000 + EXCEL_EPOCH_DAYS
    return `<c r="${ref}" s="${STYLE_DATE}"><v>${days}</v></c>`
  }
  if (!Number.isFinite(cell)) return ''
  const style = Number.isInteger(cell) ? ` s="${STYLE_INTEGER}"` : ''
  return `<c r="${ref}"${style}><v>${cell}</v></c>`
}

export interface SheetSpec {
  /** At most 31 characters, none of `[]:*?/\`. */
  name: string
  /** Bold, frozen first row. */
  header: readonly string[]
  /** Column widths in characters, one per column. */
  widths: readonly number[]
  rows: Iterable<readonly Cell[]>
  /** Data rows after which the sheet stops (default: Excel's limit). */
  maxRows?: number
}

export interface SheetResult {
  rows: number
  /** The rows ran out of room: some were left out. */
  truncated: boolean
}

/** About this much text is gathered before it goes to the compressor. */
const BATCH_CHARS = 64 * 1024

async function writeSheet(
  push: (text: string) => Promise<void>,
  sheet: SheetSpec,
): Promise<SheetResult> {
  const cols = sheet.widths
    .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
    .join('')
  let batch =
    `${XML_HEAD}<worksheet xmlns="${MAIN_NS}"><sheetViews><sheetView workbookViewId="0">` +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>' +
    `</sheetViews><cols>${cols}</cols><sheetData>`
  const flush = async () => {
    const text = batch
    batch = ''
    await push(text)
  }
  batch +=
    '<row r="1">' +
    sheet.header.map((text, i) => textCell(`${columnName(i)}1`, text, STYLE_BOLD)).join('') +
    '</row>'
  const maxRows = sheet.maxRows ?? XLSX_MAX_ROWS
  let rows = 0
  let truncated = false
  for (const row of sheet.rows) {
    if (rows === maxRows) {
      truncated = true
      break
    }
    rows += 1
    batch += `<row r="${rows + 1}">`
    for (let i = 0; i < row.length; i += 1) {
      batch += cellXml(columnName(i) + (rows + 1), row[i] ?? null)
    }
    batch += '</row>'
    if (batch.length >= BATCH_CHARS) await flush()
  }
  batch += '</sheetData></worksheet>'
  await flush()
  return { rows, truncated }
}

const STYLES_XML =
  `${XML_HEAD}<styleSheet xmlns="${MAIN_NS}">` +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>'

/**
 * Writes a workbook with one worksheet per spec, streaming, and says how many rows each got.
 * Inline strings only (no shared-strings part) and four cell styles: normal, bold header, date and
 * whole number (so a size of 13 digits is not shown as 1.2E+12).
 */
export async function writeXlsx(
  write: Write,
  sheets: readonly SheetSpec[],
): Promise<SheetResult[]> {
  const zip = new ZipWriter(write)
  const part = (name: string, xml: string) => zip.addEntry(name, (push) => push(xml))
  const indexes = sheets.map((_, i) => i + 1)

  await part(
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>` +
      indexes
        .map(
          (n) =>
            `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${CT}.worksheet+xml"/>`,
        )
        .join('') +
      '</Types>',
  )
  await part(
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rId1" Type="${DOC_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  await part(
    'xl/workbook.xml',
    `${XML_HEAD}<workbook xmlns="${MAIN_NS}" xmlns:r="${DOC_REL}"><sheets>` +
      sheets
        .map(
          (sheet, i) =>
            `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
        )
        .join('') +
      '</sheets></workbook>',
  )
  await part(
    'xl/_rels/workbook.xml.rels',
    `${XML_HEAD}<Relationships xmlns="${REL_NS}">` +
      indexes
        .map(
          (n) =>
            `<Relationship Id="rId${n}" Type="${DOC_REL}/worksheet" Target="worksheets/sheet${n}.xml"/>`,
        )
        .join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="${DOC_REL}/styles" Target="styles.xml"/>` +
      '</Relationships>',
  )
  await part('xl/styles.xml', STYLES_XML)

  const results: SheetResult[] = []
  for (const [i, sheet] of sheets.entries()) {
    await zip.addEntry(`xl/worksheets/sheet${i + 1}.xml`, async (push) => {
      results.push(await writeSheet(push, sheet))
    })
  }
  await zip.finish()
  return results
}
