import { readFileSync } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

const ICON_PATH = path.resolve(__dirname, '../../build/icon.ico')
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const EXPECTED_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

interface IcoEntry {
  size: number
  png: Buffer
}

function readIco(file: Buffer): IcoEntry[] {
  expect(file.readUInt16LE(0)).toBe(0)
  expect(file.readUInt16LE(2)).toBe(1)
  const count = file.readUInt16LE(4)
  const entries: IcoEntry[] = []
  for (let index = 0; index < count; index += 1) {
    const at = 6 + 16 * index
    const width = file.readUInt8(at) || 256
    const height = file.readUInt8(at + 1) || 256
    expect(height).toBe(width)
    const length = file.readUInt32LE(at + 8)
    const offset = file.readUInt32LE(at + 12)
    entries.push({ size: width, png: file.subarray(offset, offset + length) })
  }
  return entries
}

interface DecodedPng {
  width: number
  height: number
  /** RGBA, 8 bits per channel. */
  pixels: Buffer
}

/** Decodes an 8-bit RGBA, non-interlaced PNG (what Electron's toPNG produces). */
function decodePng(png: Buffer): DecodedPng {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  let width = 0
  let height = 0
  const chunks: Buffer[] = []
  let at = 8
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    const type = png.toString('latin1', at + 4, at + 8)
    const data = png.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect(data.readUInt8(8)).toBe(8)
      expect(data.readUInt8(9)).toBe(6)
      expect(data.readUInt8(12)).toBe(0)
    } else if (type === 'IDAT') {
      chunks.push(data)
    }
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(chunks))
  const stride = width * 4
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw.readUInt8(y * (stride + 1))
    for (let x = 0; x < stride; x += 1) {
      const value = raw.readUInt8(y * (stride + 1) + 1 + x)
      const left = x >= 4 ? pixels.readUInt8(y * stride + x - 4) : 0
      const up = y > 0 ? pixels.readUInt8((y - 1) * stride + x) : 0
      const upLeft = y > 0 && x >= 4 ? pixels.readUInt8((y - 1) * stride + x - 4) : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = up
      else if (filter === 3) predictor = (left + up) >> 1
      else if (filter === 4) {
        const estimate = left + up - upLeft
        const dLeft = Math.abs(estimate - left)
        const dUp = Math.abs(estimate - up)
        const dUpLeft = Math.abs(estimate - upLeft)
        predictor = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft
      }
      pixels.writeUInt8((value + predictor) & 0xff, y * stride + x)
    }
  }
  return { width, height, pixels }
}

function pixelAt(image: DecodedPng, x: number, y: number): [number, number, number, number] {
  const at = (y * image.width + x) * 4
  return [
    image.pixels.readUInt8(at),
    image.pixels.readUInt8(at + 1),
    image.pixels.readUInt8(at + 2),
    image.pixels.readUInt8(at + 3),
  ]
}

describe('build/icon.ico', () => {
  const entries = readIco(readFileSync(ICON_PATH))

  it('holds the nine sizes Windows asks for', () => {
    expect(entries.map((entry) => entry.size)).toEqual(EXPECTED_SIZES)
  })

  it('stores a valid PNG per entry whose IHDR size matches the entry', () => {
    for (const entry of entries) {
      const image = decodePng(entry.png)
      expect([image.width, image.height]).toEqual([entry.size, entry.size])
    }
  })

  it('has white S strokes and a transparent outside corner at 256 px', () => {
    const entry = entries.find((candidate) => candidate.size === 256)
    expect(entry).toBeDefined()
    const image = decodePng(entry?.png ?? Buffer.alloc(0))
    // Corners are outside the rounded tile.
    expect(pixelAt(image, 0, 0)[3]).toBe(0)
    expect(pixelAt(image, 255, 255)[3]).toBe(0)
    // Centre-left of the glyph: the leftmost point of the S top arc.
    expect(pixelAt(image, 75, 101)).toEqual([255, 255, 255, 255])
  })

  it('keeps a crimson block in the centre of every size', () => {
    for (const entry of entries) {
      const image = decodePng(entry.png)
      const centre = Math.floor(entry.size / 2)
      const [red, green, blue, alpha] = pixelAt(image, centre, centre)
      expect(alpha).toBe(255)
      expect(red).toBeGreaterThan(150)
      expect(green).toBeLessThan(60)
      expect(blue).toBeLessThan(80)
    }
  })
})
