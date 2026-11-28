import { inflateRawSync } from 'node:zlib'

/** The files of a ZIP by name, read through its central directory (what the .xlsx test needs). */
export function zipFiles(zip: Buffer): Map<string, string> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('not a ZIP file')
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, string>()
  for (let i = 0; i < count; i += 1) {
    const compressed = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    files.set(name, inflateRawSync(zip.subarray(start, start + compressed)).toString('utf8'))
    at += 46 + nameLength
  }
  return files
}
