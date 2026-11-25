// Release gate, run by .github/workflows/release.yml before building: the tag must equal
// "v" + package.json's version, and CHANGELOG.md must have an entry for exactly that version
// (the What's new window shows it after the update).
// Usage: node scripts/check-release.mjs <tag> [package.json] [CHANGELOG.md]
import { readFileSync } from 'node:fs'

const [tag, packagePath = 'package.json', changelogPath = 'CHANGELOG.md'] = process.argv.slice(2)
if (tag === undefined || tag === '') {
  console.error('Usage: node scripts/check-release.mjs <tag> [package.json] [CHANGELOG.md]')
  process.exit(2)
}

const { version } = JSON.parse(readFileSync(packagePath, 'utf8'))
if (typeof version !== 'string' || tag !== `v${version}`) {
  console.error(`Tag ${tag} does not match package.json version v${String(version)}`)
  process.exit(1)
}

const headings = readFileSync(changelogPath, 'utf8')
  .split(/\r?\n/)
  .map((line) => /^##\s*\[([^\]]+)\]/.exec(line)?.[1])
if (!headings.includes(version)) {
  console.error(`${changelogPath} has no entry "## [${version}]" for the tagged version`)
  process.exit(1)
}
console.log(`Release ${tag}: package.json and CHANGELOG agree.`)
