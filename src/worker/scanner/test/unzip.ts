import { crc32, inflateRawSync } from 'node:zlib'
import { expect } from 'vitest'

/** Reads a ZIP the way a reader does: the central directory, then each entry's bytes. */
export function unzip(zip: Buffer): Map<string, string> {
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
