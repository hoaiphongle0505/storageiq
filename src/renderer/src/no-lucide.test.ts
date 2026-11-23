/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as icons from './lib/icons'

/** Written in two pieces so this file does not mention the removed package itself. */
const REMOVED = ['luc', 'ide'].join('')
const FLUENT = '@fluentui/react-icons'

const root = process.cwd()
const SKIPPED_DIRS = new Set(['node_modules', 'out', 'release', 'dist', '.git'])

/** Every file under `target` (a file or a folder), without build output. */
function filesUnder(target: string): string[] {
  const full = path.join(root, target)
  let info
  try {
    info = statSync(full)
  } catch {
    return []
  }
  if (info.isFile()) return [full]
  return readdirSync(full).flatMap((name) =>
    SKIPPED_DIRS.has(name) ? [] : filesUnder(path.join(target, name)),
  )
}

const read = (file: string) => readFileSync(file, 'utf8')

describe('Fluent icons replace the old icon package', () => {
  it('package.json lists no lucide package', () => {
    expect(read(path.join(root, 'package.json')).toLowerCase()).not.toContain(REMOVED)
  })

  it('package-lock.json has no lucide-react entry', () => {
    expect(read(path.join(root, 'package-lock.json')).toLowerCase()).not.toContain(REMOVED)
  })

  it('no source, script, e2e or design file mentions lucide', () => {
    const offenders = [
      ...filesUnder('src'),
      ...filesUnder('scripts'),
      ...filesUnder('e2e'),
      ...filesUnder('design'),
      path.join(root, 'electron.vite.config.ts'),
    ]
      .filter((file) => /\.(tsx?|mjs|cjs|json|css|md|ya?ml)$/.test(file))
      .filter((file) => !file.endsWith('no-lucide.test.ts'))
      .filter((file) => read(file).toLowerCase().includes(REMOVED))
    expect(offenders.map((file) => path.relative(root, file))).toEqual([])
  })

  it('lib/icons.ts is the only file that imports @fluentui/react-icons', () => {
    const importers = filesUnder('src/renderer/src')
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => read(file).includes(FLUENT))
      .map((file) => path.relative(root, file).replaceAll('\\', '/'))
    expect(importers).toEqual(['src/renderer/src/lib/icons.ts'])
  })

  it('every icon exported by lib/icons.ts is a React component', () => {
    const names = Object.keys(icons)
    expect(names.length).toBeGreaterThan(20)
    for (const name of names) {
      expect(name).toMatch(/^Icon[A-Z]/)
      const icon = (icons as Record<string, unknown>)[name]
      // A function component, or an object component (memo, forwardRef).
      const isComponent =
        typeof icon === 'function' ||
        (typeof icon === 'object' && icon !== null && '$$typeof' in icon)
      expect(isComponent, name).toBe(true)
    }
  })
})
