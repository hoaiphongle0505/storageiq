import { describe, expect, it, vi } from 'vitest'
import { createAppSettingsStore } from './app-settings-store'

function setup(files: Record<string, string> = {}, failWrite = false) {
  const log = vi.fn()
  const calls: string[] = []
  const store = createAppSettingsStore({
    filePath: 'u/settings.json',
    readFile: async (file) => {
      const text = files[file]
      if (text === undefined) throw new Error('ENOENT')
      return text
    },
    writeFile: async (file, text) => {
      calls.push(`write ${file}`)
      if (failWrite) throw new Error('disk full')
      files[file] = text
    },
    rename: async (from, to) => {
      calls.push(`rename ${from} ${to}`)
      files[to] = files[from] ?? ''
      delete files[from]
    },
    log,
  })
  return { store, files, calls, log }
}

describe('app settings store', () => {
  it('automatic update checks are on by default (no file)', async () => {
    expect(await setup().store.readAutoUpdate()).toBe(true)
  })

  it.each(['{nope', '', 'null', '{"autoUpdate":"no"}', '{"autoUpdate":0}', '[]'])(
    'a corrupt or unusable file (%j) falls back to on',
    async (text) => {
      expect(await setup({ 'u/settings.json': text }).store.readAutoUpdate()).toBe(true)
    },
  )

  it('round-trips both values', async () => {
    const { store } = setup()
    await store.writeAutoUpdate(false)
    expect(await store.readAutoUpdate()).toBe(false)
    await store.writeAutoUpdate(true)
    expect(await store.readAutoUpdate()).toBe(true)
  })

  it('writes through a temp file and a rename', async () => {
    const { store, calls, files } = setup()
    await store.writeAutoUpdate(false)
    expect(calls).toEqual([
      'write u/settings.json.tmp',
      'rename u/settings.json.tmp u/settings.json',
    ])
    expect(JSON.parse(files['u/settings.json'] ?? '')).toEqual({ autoUpdate: false })
    expect(files['u/settings.json.tmp']).toBeUndefined()
  })

  it('a failed write is logged, never thrown, and leaves the old value', async () => {
    const { store, log } = setup({ 'u/settings.json': '{"autoUpdate":false}' }, true)
    await expect(store.writeAutoUpdate(true)).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
    expect(await store.readAutoUpdate()).toBe(false)
  })
})
