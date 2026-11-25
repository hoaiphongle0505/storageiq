export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Dot-separated pre-release identifiers; empty for a release. */
  prerelease: string[]
}

const MAX_LENGTH = 64
const NUMERIC = /^(0|[1-9]\d{0,8})$/
const IDENTIFIER = /^[0-9A-Za-z-]+$/

/** Parses `MAJOR.MINOR.PATCH[-prerelease][+build]`; null for anything else (no leading `v`). */
export function parseVersion(version: string): ParsedVersion | null {
  if (typeof version !== 'string' || version.length === 0 || version.length > MAX_LENGTH) {
    return null
  }
  const plus = version.indexOf('+')
  const build = plus === -1 ? null : version.slice(plus + 1)
  const main = plus === -1 ? version : version.slice(0, plus)
  if (build !== null && (build === '' || !build.split('.').every((id) => IDENTIFIER.test(id)))) {
    return null
  }
  const dash = main.indexOf('-')
  const core = dash === -1 ? main : main.slice(0, dash)
  const pre = dash === -1 ? null : main.slice(dash + 1)
  const numbers = core.split('.')
  if (numbers.length !== 3 || !numbers.every((part) => NUMERIC.test(part))) return null
  let prerelease: string[] = []
  if (pre !== null) {
    prerelease = pre.split('.')
    for (const id of prerelease) {
      if (!IDENTIFIER.test(id)) return null
      if (/^\d+$/.test(id) && !NUMERIC.test(id)) return null
    }
  }
  return {
    major: Number(numbers[0]),
    minor: Number(numbers[1]),
    patch: Number(numbers[2]),
    prerelease,
  }
}

function sign(n: number): -1 | 0 | 1 {
  return n < 0 ? -1 : n > 0 ? 1 : 0
}

/** Semver 2.0 precedence; null when either version is invalid. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (x === null || y === null) return null
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (x[key] !== y[key]) return sign(x[key] - y[key])
  }
  if (x.prerelease.length === 0 && y.prerelease.length === 0) return 0
  if (x.prerelease.length === 0) return 1
  if (y.prerelease.length === 0) return -1
  const length = Math.min(x.prerelease.length, y.prerelease.length)
  for (let i = 0; i < length; i++) {
    const p = x.prerelease[i] ?? ''
    const q = y.prerelease[i] ?? ''
    if (p === q) continue
    const pNum = /^\d+$/.test(p)
    const qNum = /^\d+$/.test(q)
    if (pNum && qNum) return sign(Number(p) - Number(q))
    if (pNum) return -1
    if (qNum) return 1
    return p < q ? -1 : 1
  }
  return sign(x.prerelease.length - y.prerelease.length)
}
