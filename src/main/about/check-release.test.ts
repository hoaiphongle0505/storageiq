import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'siq-release-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function run(tag: string, version: string, changelog: string) {
  const pkg = join(dir, 'package.json')
  const log = join(dir, 'CHANGELOG.md')
  writeFileSync(pkg, JSON.stringify({ version }))
  writeFileSync(log, changelog)
  return spawnSync(process.execPath, [resolve('scripts/check-release.mjs'), tag, pkg, log], {
    encoding: 'utf8',
  })
}

describe('scripts/check-release.mjs', () => {
  const log = '# Changelog\n\n## [0.2.0-beta.1] - 2026-11-25\n\n- a\n\n## [0.1.0]\n- b\n'

  it('passes when tag, package.json and the changelog agree', () => {
    expect(run('v0.2.0-beta.1', '0.2.0-beta.1', log).status).toBe(0)
  })

  it('fails when the tag differs from package.json', () => {
    const result = run('v0.2.0-beta.2', '0.2.0-beta.1', log)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('does not match')
  })

  it('fails when the changelog has no entry for the exact version', () => {
    const result = run('v0.2.0', '0.2.0', log)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('no entry')
  })

  it('fails without a tag', () => {
    expect(spawnSync(process.execPath, [resolve('scripts/check-release.mjs')]).status).toBe(2)
  })
})
