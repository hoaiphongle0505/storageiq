// Runs the packaged app with --self-test: koffi must load from app.asar.unpacked, at least one
// drive must be listed, the Explorer context menu must build through COM, and the scanner
// utilityProcess must complete a scan of the resources folder without walking into app.asar.
// Exit code 0 means pass (codes: src/main/self-test.ts).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const { version, productName } = JSON.parse(readFileSync('package.json', 'utf8'))
const exe = path.resolve('release', version, 'win-unpacked', `${productName}.exe`)
if (!existsSync(exe)) {
  console.error(`Packaged app not found at ${exe}. Run "npm run dist" first.`)
  process.exit(1)
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
  'Packaged self-test passed: koffi loaded from app.asar.unpacked; the Explorer menu built; the scanner ran.',
)
