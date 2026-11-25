import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodeRgbaPng } from './png'

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The chunks of a PNG as `{ type, data }`. */
function chunksOf(png: Uint8Array): Array<{ type: string; data: Buffer }> {
  const buffer = Buffer.from(png)
  const chunks: Array<{ type: string; data: Buffer }> = []
  let offset = 8
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    chunks.push({
      type: buffer.toString('latin1', offset + 4, offset + 8),
      data: buffer.subarray(offset + 8, offset + 8 + length),
    })
    offset += 12 + length
  }
  return chunks
}

function bitmap(width: number, height: number) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 1) data[i] = (i * 37 + 11) % 256
  return { width, height, data }
}

describe('encodeRgbaPng', () => {
  it('encodes an RGBA bitmap as a PNG that Node’s zlib can inflate back to the same pixels', () => {
    const source = bitmap(5, 3)
    const png = encodeRgbaPng(source)
    const idat = Buffer.concat(
      chunksOf(png)
        .filter((chunk) => chunk.type === 'IDAT')
        .map((chunk) => chunk.data),
    )
    const raw = inflateSync(idat)
    expect(raw.length).toBe(3 * (1 + 5 * 4))
    for (let y = 0; y < 3; y += 1) {
      const line = raw.subarray(y * 21, (y + 1) * 21)
      expect(line[0]).toBe(0) // filter 0
      expect([...line.subarray(1)]).toEqual([...source.data.subarray(y * 20, (y + 1) * 20)])
    }
  })

  it('writes the PNG signature and an IHDR with the bitmap’s width, height and colour type 6', () => {
    const png = encodeRgbaPng(bitmap(24, 16))
    expect([...png.subarray(0, 8)]).toEqual(SIGNATURE)
    const chunks = chunksOf(png)
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    const header = chunks[0]!.data
    expect(header.readUInt32BE(0)).toBe(24)
    expect(header.readUInt32BE(4)).toBe(16)
    expect(header[8]).toBe(8) // bit depth
    expect(header[9]).toBe(6) // colour type: RGBA
    expect([header[10], header[11], header[12]]).toEqual([0, 0, 0])
  })

  it('rejects a buffer whose length is not width times height times four', () => {
    expect(() => encodeRgbaPng({ width: 2, height: 2, data: new Uint8Array(15) })).toThrow(
      /width times height times four/,
    )
    expect(() => encodeRgbaPng({ width: 0, height: 2, data: new Uint8Array(0) })).toThrow()
  })
})
