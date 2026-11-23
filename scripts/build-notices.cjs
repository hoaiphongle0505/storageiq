// Writes out/THIRD_PARTY_NOTICES.txt: the licence of every runtime dependency the shipped app
// contains. electron-builder runs this as its `beforePack` hook and ships the file next to the
// executable (extraResources); `npm run notices` runs it by hand.
//
// Which packages: the production dependencies (main process, from node_modules at runtime) and the
// few dev dependencies that Vite bundles into the renderer (BUNDLED_DEV_DEPENDENCIES), each with
// everything they depend on. The list is sorted and carries no date, so the output is the same on
// every machine. No network: it reads package.json and the licence files in node_modules.
// Electron's own licence files (LICENSE.electron.txt, LICENSES.chromium.html) are added by
// electron-builder itself.
const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'out', 'THIRD_PARTY_NOTICES.txt')
const BUNDLED_DEV_DEPENDENCIES = ['react', 'react-dom', 'zustand', 'lucide-react']
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|$)/i

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Finds `name` the way Node does: in `from`'s node_modules, then in each parent's. */
function locate(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
    if (dir === path.dirname(dir)) return null
  }
}

function licenseText(dir) {
  const files = readdirSync(dir)
    .filter((file) => LICENSE_FILE.test(file))
    .sort()
  return files
    .map((file) => readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim())
    .join('\n\n')
}

function licenseId(meta) {
  if (typeof meta.license === 'string') return meta.license
  if (meta.license && typeof meta.license.type === 'string') return meta.license.type
  if (Array.isArray(meta.licenses)) return meta.licenses.map((entry) => entry.type).join(' OR ')
  return 'UNKNOWN'
}

function collect() {
  const rootMeta = readJson(path.join(ROOT, 'package.json'))
  const queue = [...Object.keys(rootMeta.dependencies ?? {}), ...BUNDLED_DEV_DEPENDENCIES].map(
    (name) => ({ name, from: ROOT }),
  )
  const seen = new Map()
  while (queue.length > 0) {
    const { name, from } = queue.shift()
    const dir = locate(name, from)
    if (dir === null) {
      // Optional dependencies (koffi's other platforms) are not installed: skip those only.
      if (from === ROOT) throw new Error(`Dependency ${name} is not installed. Run npm ci.`)
      continue
    }
    const meta = readJson(path.join(dir, 'package.json'))
    const key = `${meta.name}@${meta.version}`
    if (seen.has(key)) continue
    seen.set(key, { meta, dir })
    for (const dependency of [
      ...Object.keys(meta.dependencies ?? {}),
      ...Object.keys(meta.optionalDependencies ?? {}),
    ]) {
      queue.push({ name: dependency, from: dir })
    }
  }
  return [...seen.values()].sort((a, b) => {
    const left = `${a.meta.name}@${a.meta.version}`
    const right = `${b.meta.name}@${b.meta.version}`
    return left < right ? -1 : left > right ? 1 : 0
  })
}

function render(packages) {
  const parts = [
    'THIRD-PARTY NOTICES',
    '',
    'StorageIQ is MIT licensed. It ships with the open-source packages below. Electron and',
    'Chromium licences are in LICENSE.electron.txt and LICENSES.chromium.html next to the program.',
    '',
  ]
  for (const { meta, dir } of packages) {
    const repository =
      typeof meta.repository === 'string' ? meta.repository : (meta.repository?.url ?? '')
    parts.push('='.repeat(72), `${meta.name} ${meta.version}  (${licenseId(meta)})`)
    if (repository) parts.push(repository)
    parts.push('='.repeat(72), '')
    const text = licenseText(dir)
    parts.push(
      text === ''
        ? `No licence file is included in the package; licence: ${licenseId(meta)}.`
        : text,
      '',
    )
  }
  return `${parts.join('\n')}\n`
}

function writeNotices() {
  const packages = collect()
  mkdirSync(path.dirname(OUTPUT), { recursive: true })
  writeFileSync(OUTPUT, render(packages))
  return { file: OUTPUT, count: packages.length }
}

module.exports = async function beforePack() {
  const { file, count } = writeNotices()
  console.log(`  • third-party notices  packages=${count} file=${path.relative(ROOT, file)}`)
}
module.exports.default = module.exports
module.exports.collect = collect
module.exports.render = render
module.exports.writeNotices = writeNotices

if (require.main === module) {
  const { file, count } = writeNotices()
  console.log(`Wrote ${count} packages to ${path.relative(ROOT, file)}`)
}
