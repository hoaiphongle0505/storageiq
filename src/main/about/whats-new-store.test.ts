import { describe, expect, it, vi } from 'vitest'
import { createWhatsNewStore } from './whats-new-store'

function setup(files: Record<string, string> = {}, failWrite = false) {
  const log = vi.fn()
  const calls: string[] = []
  const store = createWhatsNewStore({
    filePath: 'u/whats-new.json',
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

describe('whats-new-store', () => {
  it('a missing file reads as null', async () => {
    expect(await setup().store.read()).toBeNull()
  })

  it('a corrupt file reads as null', async () => {
    expect(await setup({ 'u/whats-new.json': '{nope' }).store.read()).toBeNull()
    expect(await setup({ 'u/whats-new.json': '{"lastSeenVersion":3}' }).store.read()).toBeNull()
  })

  it('write goes through a temp file and a rename', async () => {
    const { store, calls, files } = setup()
    await store.write('0.2.0')
    expect(calls).toEqual([
      'write u/whats-new.json.tmp',
      'rename u/whats-new.json.tmp u/whats-new.json',
    ])
    expect(await store.read()).toBe('0.2.0')
    expect(files['u/whats-new.json']).toBe('{"lastSeenVersion":"0.2.0"}')
  })

  it('a failed write is logged and not thrown', async () => {
    const { store, log } = setup({}, true)
    await expect(store.write('0.2.0')).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
  })
})
