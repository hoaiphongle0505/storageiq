// Report-only metrics for CI (roadmap carry-over 7): renderer bundle size, installer size,
// idle RAM, scan time of a generated ~20,000-file tree, and cancel latency. Never fails the build.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const kilobytes = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

function rendererBundleBytes() {
  const dir = path.join('out', 'renderer', 'assets')
  if (!existsSync(dir)) return null
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
    .reduce((sum, name) => sum + statSync(path.join(dir, name)).size, 0)
}

function installerBytes() {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const dir = path.join('release', version)
  if (!existsSync(dir)) return null
  const installer = readdirSync(dir).find((name) => name.endsWith('.exe'))
  return installer ? statSync(path.join(dir, installer)).size : null
}

function e2eMetrics() {
  const file = path.join('metrics', 'e2e-metrics.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

const bundle = rendererBundleBytes()
const installer = installerBytes()
const e2e = e2eMetrics()
const rows = [
  ['Renderer bundle (JS + CSS)', bundle === null ? 'n/a' : kilobytes(bundle)],
  ['Installer', installer === null ? 'n/a' : megabytes(installer)],
  [
    'Idle RAM (working set, all processes)',
    e2e ? `${e2e.idleWorkingSetMb} MB (raw ${e2e.idleWorkingSetKb})` : 'n/a',
  ],
  [
    `Scan time, ${e2e ? e2e.scanFiles : 20000} generated files (wall clock)`,
    e2e ? `${(e2e.scanWallMs / 1000).toFixed(1)} s` : 'n/a',
  ],
  ['Cancel latency, system drive (target < 500 ms)', e2e ? `${e2e.cancelMs} ms` : 'n/a'],
]
const table = [
  '| Metric | Value |',
  '| --- | --- |',
  ...rows.map(([name, value]) => `| ${name} | ${value} |`),
].join('\n')

console.log(table)
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `## StorageIQ metrics (report only)\n\n${table}\n`,
  )
}
