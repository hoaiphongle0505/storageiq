// Regenerates build/icon.ico (9 PNG-compressed sizes) and build/icon.png (256 px) from the SVGs in
// build/. It rasterises with Electron's offscreen rendering, so run it through Electron:
//   npm run icon        (needs ELECTRON_RUN_AS_NODE to be unset)
// Output is deterministic: running it twice produces byte-identical files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = path.join(root, 'build')
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const sourceFor = (size) =>
  size <= 16
    ? 'icon-16.svg'
    : size === 20
      ? 'icon-20.svg'
      : size === 24
        ? 'icon-24.svg'
        : 'icon.svg'

// One device pixel per CSS pixel whatever the display scaling, so a capture is exactly size x size.
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.commandLine.appendSwitch('high-dpi-support', '1')

// One transparent offscreen page; each size is an <img> at its exact pixel size in the top-left
// corner, captured by rectangle.
async function createRasteriser() {
  const win = new BrowserWindow({
    show: false,
    width: 256,
    height: 256,
    useContentSize: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  })
  const page =
    '<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">' +
    '<img id="i" style="display:block"></body></html>'
  await win.loadURL(`data:text/html;base64,${Buffer.from(page).toString('base64')}`)
  return {
    async render(svgText, size) {
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgText).toString('base64')}`
      await win.webContents.executeJavaScript(`(async () => {
        const img = document.getElementById('i')
        img.width = ${size}
        img.height = ${size}
        img.src = ${JSON.stringify(dataUrl)}
        await img.decode()
      })()`)
      await new Promise((resolve) => setTimeout(resolve, 200))
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
      const actual = image.getSize()
      if (actual.width !== size || actual.height !== size) {
        throw new Error(`Captured ${actual.width}x${actual.height}, expected ${size}x${size}`)
      }
      return image.toPNG()
    },
    close: () => win.destroy(),
  }
}

function packIco(entries) {
  const header = Buffer.alloc(6 + 16 * entries.length)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  let offset = header.length
  entries.forEach(({ size, png }, index) => {
    const at = 6 + 16 * index
    header.writeUInt8(size >= 256 ? 0 : size, at) // width (0 means 256)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt8(0, at + 2) // palette colours
    header.writeUInt8(0, at + 3)
    header.writeUInt16LE(1, at + 4) // colour planes
    header.writeUInt16LE(32, at + 6) // bits per pixel
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...entries.map((entry) => entry.png)])
}

async function main() {
  const rasteriser = await createRasteriser()
  try {
    mkdirSync(buildDir, { recursive: true })
    const entries = []
    for (const size of SIZES) {
      const svg = readFileSync(path.join(buildDir, sourceFor(size)), 'utf8')
      entries.push({ size, png: await rasteriser.render(svg, size) })
    }
    writeFileSync(path.join(buildDir, 'icon.ico'), packIco(entries))
    writeFileSync(path.join(buildDir, 'icon.png'), entries[entries.length - 1].png)
    if (process.env.ICON_SHEET_DIR) {
      // Debug aid: the raw PNG per size, for building a contact sheet.
      mkdirSync(process.env.ICON_SHEET_DIR, { recursive: true })
      for (const { size, png } of entries) {
        writeFileSync(path.join(process.env.ICON_SHEET_DIR, `icon-${size}.png`), png)
      }
    }
    console.log(`Wrote build/icon.ico (${SIZES.join(', ')}) and build/icon.png`)
  } finally {
    rasteriser.close()
    app.quit()
  }
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
    app.quit()
  })
