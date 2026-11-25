// Runs the packaged app with --self-test: koffi must load from app.asar.unpacked, at least one
// drive must be listed, the Explorer context menu must build through COM, and the scanner
// utilityProcess must complete a scan of the resources folder without walking into app.asar, and the
// shell worker thread must build the Explorer menu (so a missing shell-worker.js fails), and the
// icon worker thread must return a PNG for .txt (so a missing icon-worker.js fails).
// Exit code 0 means pass (codes: src/main/self-test.ts).
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const { version, productName } = JSON.parse(readFileSync('package.json', 'utf8'))
const exe = path.resolve('release', version, 'win-unpacked', `${productName}.exe`)
if (!existsSync(exe)) {
  console.error(`Packaged app not found at ${exe}. Run "npm run dist" first.`)
  process.exit(1)
}

// The licences of the shipped dependencies sit next to the executable, and nothing but the three worker
// scripts leaves the asar from out/main (shared chunks there would escape the integrity check).
const resources = path.join(path.dirname(exe), 'resources')
if (!existsSync(path.join(resources, 'THIRD_PARTY_NOTICES.txt'))) {
  console.error('resources/THIRD_PARTY_NOTICES.txt is missing from the packaged app.')
  process.exit(1)
}
const unpackedMain = path.join(resources, 'app.asar.unpacked', 'out', 'main')
const unpackedFiles = existsSync(unpackedMain) ? readdirSync(unpackedMain) : []
if (unpackedFiles.join() !== 'icon-worker.js,shell-worker.js,walker.js') {
  console.error(
    `out/main in app.asar.unpacked must hold only icon-worker.js, shell-worker.js and walker.js, found: ${unpackedFiles.join(', ') || 'nothing'}`,
  )
  process.exit(1)
}

// The exe carries StorageIQ's icon, not Electron's default: electron-builder embeds build/icon.ico
// into the exe's resources unchanged, so the 256 px PNG entry of the ICO must appear in the exe
// (Electron's own icon is a different image).
{
  const ico = readFileSync(path.resolve('build', 'icon.ico'))
  const entryCount = ico.readUInt16LE(4)
  let png256
  for (let index = 0; index < entryCount; index += 1) {
    const at = 6 + 16 * index
    if (ico.readUInt8(at) === 0) {
      png256 = ico.subarray(
        ico.readUInt32LE(at + 12),
        ico.readUInt32LE(at + 12) + ico.readUInt32LE(at + 8),
      )
    }
  }
  if (!png256 || !readFileSync(exe).includes(png256)) {
    console.error(`${productName}.exe does not carry the StorageIQ icon (build/icon.ico).`)
    process.exit(1)
  }
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const result = spawnSync(exe, ['--self-test'], { env, encoding: 'utf8', timeout: 120_000 })
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`Packaged self-test failed with exit code ${result.status}.`)
  process.exit(1)
}
console.log(
  'Packaged self-test passed: koffi loaded from app.asar.unpacked; the Explorer menu built; the icon worker returned a PNG; the scanner ran; the exe carries the StorageIQ icon.',
)
