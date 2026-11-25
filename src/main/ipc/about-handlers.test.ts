import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  ABOUT_LINK_URLS,
  type AboutHandlerDeps,
  createAboutHandlers,
  MAX_CHANGELOG_RESULT,
} from './about-handlers'
import { InvalidIpcArgumentsError } from './parse-args'

const event = {} as IpcMainInvokeEvent

const CHANGELOG = [
  '# Changelog',
  '## [0.2.0] - 2026-12-01',
  '- Stable',
  '## [0.2.0-beta.2]',
  '- Beta two',
  '## [0.2.0-beta.1]',
  '- Beta one',
].join('\n')

function setup(version: string, stored: string | null, overrides: Partial<AboutHandlerDeps> = {}) {
  const write = vi.fn<(version: string) => Promise<void>>(async () => undefined)
  const deps: AboutHandlerDeps = {
    version,
    readChangelog: async () => CHANGELOG,
    store: { read: async () => stored, write },
    noticesPath: 'C:\\app\\THIRD_PARTY_NOTICES.txt',
    fileExists: async () => true,
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined),
    log: vi.fn(),
    ...overrides,
  }
  return { handlers: createAboutHandlers(deps), deps, write }
}

describe('about handlers', () => {
  it('get-whats-new-due returns null and records the version on a first install', async () => {
    const { handlers, write } = setup('0.2.0-beta.1', null)
    expect(await handlers['app:get-whats-new-due'].handle(event)).toBeNull()
    expect(write).toHaveBeenCalledWith('0.2.0-beta.1')
  })

  it('get-whats-new-due returns the entry after an upgrade and does not write', async () => {
    const { handlers, write } = setup('0.2.0-beta.2', '0.1.0')
    const entry = await handlers['app:get-whats-new-due'].handle(event)
    expect(entry?.version).toBe('0.2.0-beta.2')
    expect(write).not.toHaveBeenCalled()
  })

  it('get-whats-new-due compares prerelease versions (beta.1 to beta.2, beta to stable)', async () => {
    const toBeta2 = setup('0.2.0-beta.2', '0.2.0-beta.1')
    expect((await toBeta2.handlers['app:get-whats-new-due'].handle(event))?.version).toBe(
      '0.2.0-beta.2',
    )
    const toStable = setup('0.2.0', '0.2.0-beta.2')
    expect((await toStable.handlers['app:get-whats-new-due'].handle(event))?.version).toBe('0.2.0')
    const same = setup('0.2.0', '0.2.0')
    expect(await same.handlers['app:get-whats-new-due'].handle(event)).toBeNull()
    expect(same.write).not.toHaveBeenCalled()
  })

  it('get-whats-new-due returns null and records the version on a downgrade', async () => {
    const { handlers, write } = setup('0.2.0-beta.1', '0.2.0')
    expect(await handlers['app:get-whats-new-due'].handle(event)).toBeNull()
    expect(write).toHaveBeenCalledWith('0.2.0-beta.1')
  })

  it('get-whats-new-due returns null and records the version when the changelog has no entry', async () => {
    const { handlers, write } = setup('0.3.0', '0.2.0')
    expect(await handlers['app:get-whats-new-due'].handle(event)).toBeNull()
    expect(write).toHaveBeenCalledWith('0.3.0')
  })

  it('mark-whats-new-seen writes the running version', async () => {
    const { handlers, write } = setup('0.2.0', '0.1.0')
    await handlers['app:mark-whats-new-seen'].handle(event)
    expect(write).toHaveBeenCalledWith('0.2.0')
  })

  it('get-changelog returns at most 10 entries and an empty list when the file is missing', async () => {
    const many = Array.from({ length: 20 }, (_, i) => `## [1.0.${i}]\n- a\n`).join('')
    const capped = setup('1.0.0', null, { readChangelog: async () => many })
    expect(await capped.handlers['app:get-changelog'].handle(event)).toHaveLength(
      MAX_CHANGELOG_RESULT,
    )
    const missing = setup('1.0.0', null, {
      readChangelog: async () => {
        throw new Error('ENOENT')
      },
    })
    expect(await missing.handlers['app:get-changelog'].handle(event)).toEqual([])
  })

  it('get-changelog reads the file once per session', async () => {
    const readChangelog = vi.fn(async () => CHANGELOG)
    const { handlers } = setup('1.0.0', null, { readChangelog })
    await handlers['app:get-changelog'].handle(event)
    await handlers['app:get-changelog'].handle(event)
    expect(readChangelog).toHaveBeenCalledTimes(1)
  })

  it('open-notices returns opened false when the file is missing or openPath fails', async () => {
    const ok = setup('1.0.0', null)
    expect(await ok.handlers['app:open-notices'].handle(event)).toEqual({ opened: true })
    expect(ok.deps.openPath).toHaveBeenCalledWith('C:\\app\\THIRD_PARTY_NOTICES.txt')

    const missing = setup('1.0.0', null, { fileExists: async () => false })
    expect(await missing.handlers['app:open-notices'].handle(event)).toEqual({ opened: false })
    expect(missing.deps.openPath).not.toHaveBeenCalled()

    const failing = setup('1.0.0', null, { openPath: async () => 'No application' })
    expect(await failing.handlers['app:open-notices'].handle(event)).toEqual({ opened: false })
  })

  it('open-link opens only the five fixed URLs', async () => {
    const { handlers, deps } = setup('1.0.0', null)
    for (const key of ['repo', 'license', 'releases', 'help', 'issues'] as const) {
      await handlers['app:open-link'].handle(event, key)
    }
    expect(vi.mocked(deps.openExternal).mock.calls.map((c) => c[0])).toEqual([
      'https://github.com/hoaiphongle0505/storageiq',
      'https://github.com/hoaiphongle0505/storageiq/blob/main/LICENSE',
      'https://github.com/hoaiphongle0505/storageiq/releases',
      'https://github.com/hoaiphongle0505/storageiq#readme',
      'https://github.com/hoaiphongle0505/storageiq/issues/new/choose',
    ])
    expect(Object.keys(ABOUT_LINK_URLS)).toHaveLength(5)
  })

  it('open-link logs a rejected openExternal instead of throwing', async () => {
    const { handlers, deps } = setup('1.0.0', null, {
      openExternal: async () => {
        throw new Error('no browser')
      },
    })
    await expect(handlers['app:open-link'].handle(event, 'repo')).resolves.toBeUndefined()
    expect(deps.log).toHaveBeenCalled()
  })

  it('open-link rejects an unknown key, a URL, a missing argument and extra arguments', () => {
    const { handlers } = setup('1.0.0', null)
    const parse = handlers['app:open-link'].parseArgs
    expect(parse(['repo'])).toEqual(['repo'])
    for (const bad of [['nope'], ['https://example.com'], [], ['repo', 'help'], [1], [null]]) {
      expect(() => parse(bad)).toThrow(InvalidIpcArgumentsError)
    }
  })

  it('zero-argument channels reject any argument', () => {
    const { handlers } = setup('1.0.0', null)
    for (const channel of [
      'app:get-changelog',
      'app:open-notices',
      'app:get-whats-new-due',
      'app:mark-whats-new-seen',
    ] as const) {
      expect(() => handlers[channel].parseArgs(['x'])).toThrow(InvalidIpcArgumentsError)
      expect(handlers[channel].parseArgs([])).toEqual([])
    }
  })
})
