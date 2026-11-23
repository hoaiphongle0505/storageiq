import { crc32, deflateSync } from 'node:zlib'

/** RGBA pixels, top-down, straight (not premultiplied) alpha. */
export interface RgbaBitmap {
  width: number
  height: number
  data: Uint8Array
}

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  out.set(data, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/**
 * A minimal PNG encoder: 8-bit RGBA (colour type 6), filter type 0 on every line, one IDAT made
 * with `zlib.deflateSync`. Enough for 16 to 48 px icons; no dependency.
 */
export function encodeRgbaPng(bitmap: RgbaBitmap): Uint8Array {
  const { width, height, data } = bitmap
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    data.length !== width * height * 4
  ) {
    throw new Error('The pixel buffer length must be width times height times four.')
  }
  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y += 1) {
    // byte 0 of each line is the filter type (0 = none)
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}
