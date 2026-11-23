import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DirectoryLister, SyncLister } from './walk'
import {
  createWinFindLister,
  createWinFindSyncLister,
  endOfListingError,
  FILETIME_EPOCH_OFFSET_MS,
  FIND_DATA_SIZE,
  filetimeToMs,
  findPattern,
  LONG_PATH_PREFIX_AT,
  win32ErrorToCode,
} from './win-find'

const isWindows = process.platform === 'win32'

function splitTicks(ticks: bigint): { low: number; high: number } {
  return { low: Number(ticks & 0xffffffffn), high: Number(ticks >> 32n) }
}

describe('filetimeToMs', () => {
  it('converts FILETIME ticks to epoch milliseconds', () => {
    // 0x019db1ded53e8000 ticks = 116444736000000000 = the Unix epoch exactly
    expect(filetimeToMs(0xd53e8000, 0x019db1de)).toBe(0)
    expect(FILETIME_EPOCH_OFFSET_MS).toBe(11_644_473_600_000)

    const ms = Date.UTC(2026, 0, 1)
    const { low, high } = splitTicks(BigInt(ms + FILETIME_EPOCH_OFFSET_MS) * 10_000n)
    expect(filetimeToMs(low, high)).toBe(ms)

    expect(filetimeToMs(0, 0)).toBe(0)
  })
})

describe('findPattern', () => {
  it('appends \\* to a folder and always uses the long-path form', () => {
    expect(findPattern('C:\\Data')).toBe('\\\\?\\C:\\Data\\*')
    expect(findPattern('C:\\')).toBe('\\\\?\\C:\\*')
    expect(findPattern('C:\\Data\\')).toBe('\\\\?\\C:\\Data\\*')
    expect(findPattern('C:/Data/sub')).toBe('\\\\?\\C:\\Data\\sub\\*')
  })

  it('prefixes short and long paths alike, and never twice', () => {
    const short = findPattern(`C:\\${'a'.repeat(LONG_PATH_PREFIX_AT - 10)}`)
    expect(short.startsWith('\\\\?\\C:\\')).toBe(true)
    const already = `\\\\?\\C:\\${'a'.repeat(300)}`
    expect(findPattern(already)).toBe(`${already}\\*`)
  })

  it('maps UNC paths to the \\\\?\\UNC\\ form', () => {
    expect(findPattern('\\\\server\\share\\dir')).toBe('\\\\?\\UNC\\server\\share\\dir\\*')
  })
})

describe('endOfListingError', () => {
  it('treats ERROR_NO_MORE_FILES and a zero error as the normal end', () => {
    expect(endOfListingError(18)).toBeNull()
    expect(endOfListingError(0)).toBeNull()
    expect(endOfListingError(5)).toBe('EACCES')
    expect(endOfListingError(1117)).toBe('WIN32_1117')
  })
})

describe('win32ErrorToCode', () => {
  it('maps the documented codes', () => {
    expect(win32ErrorToCode(5)).toBe('EACCES')
    expect(win32ErrorToCode(2)).toBe('ENOENT')
    expect(win32ErrorToCode(3)).toBe('ENOENT')
    expect(win32ErrorToCode(53)).toBe('ENOENT')
    expect(win32ErrorToCode(206)).toBe('ENAMETOOLONG')
    expect(win32ErrorToCode(267)).toBe('ENOTDIR')
    expect(win32ErrorToCode(32)).toBe('WIN32_32')
    expect(win32ErrorToCode(1920)).toBe('WIN32_1920')
    expect(win32ErrorToCode(9999)).toBe('WIN32_9999')
  })
})

describe.runIf(isWindows)('the Windows directory lister', () => {
  let base: string
  let lister: DirectoryLister

  beforeEach(async () => {
    base = mkdtempSync(path.join(os.tmpdir(), 'storageiq-find-'))
    lister = await createWinFindLister()
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('the WIN32_FIND_DATAW struct is 592 bytes', async () => {
    const { default: koffi } = await import('koffi')
    await createWinFindLister() // registers the struct and checks its size itself
    expect(koffi.sizeof('SIQ_FIND_DATAW')).toBe(FIND_DATA_SIZE)
  })

  it('lists files with size and modification time from the listing', async () => {
    writeFileSync(path.join(base, 'a.txt'), 'hello')
    writeFileSync(path.join(base, 'b.bin'), '')
    mkdirSync(path.join(base, 'sub'))

    const listing = await lister.list(base)

    expect(listing.errorCode).toBeNull()
    expect(listing.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'b.bin', 'sub'])
    const a = listing.entries.find((e) => e.name === 'a.txt')
    expect(a?.size).toBe(5)
    expect(a?.isDirectory).toBe(false)
    expect(
      Math.abs((a?.modifiedMs ?? 0) - statSync(path.join(base, 'a.txt')).mtimeMs),
    ).toBeLessThan(5000)
    expect(listing.entries.find((e) => e.name === 'b.bin')?.size).toBe(0)
    expect(listing.entries.find((e) => e.name === 'sub')?.isDirectory).toBe(true)
  })

  it('lists a folder whose name ends in a period with its own contents', async () => {
    const dotted = path.join(base, 'trail.')
    const plain = path.join(base, 'trail')
    mkdirSync(`\\\\?\\${dotted}`)
    writeFileSync(`\\\\?\\${path.join(dotted, 'inside.txt')}`, 'abc')
    mkdirSync(plain)
    writeFileSync(path.join(plain, 'other.txt'), 'x')

    const listing = await lister.list(dotted)

    expect(listing.errorCode).toBeNull()
    expect(listing.entries.map((e) => e.name)).toEqual(['inside.txt'])
    const top = await lister.list(base)
    expect(top.entries.map((e) => e.name).sort()).toEqual(['trail', 'trail.'])
  })

  it('lists a folder deeper than 260 characters', async () => {
    const segment = 'd'.repeat(50)
    const deep = path.join(base, segment, segment, segment, segment, segment, segment)
    expect(deep.length).toBeGreaterThan(260)
    mkdirSync(`\\\\?\\${deep}`, { recursive: true })
    writeFileSync(`\\\\?\\${path.join(deep, 'deep.txt')}`, 'x')

    const listing = await lister.list(deep)

    expect(listing.errorCode).toBeNull()
    expect(listing.entries.map((e) => e.name)).toEqual(['deep.txt'])
  })

  it('flags a junction as a link and does not report it as a folder to enter', async (ctx) => {
    const target = path.join(base, 'target')
    mkdirSync(target)
    writeFileSync(path.join(target, 'x.bin'), Buffer.alloc(10))
    try {
      symlinkSync(target, path.join(base, 'junction'), 'junction')
    } catch {
      ctx.skip() // creating a junction was refused (EPERM) on this machine
      return
    }

    const listing = await lister.list(base)

    const junction = listing.entries.find((e) => e.name === 'junction')
    expect(junction?.isLink).toBe(true)
    expect(junction?.size).toBe(0)
    expect(listing.entries.find((e) => e.name === 'target')?.isLink).toBe(false)
  })

  it('flags a file symlink as a link when the machine allows creating one', async (ctx) => {
    const target = path.join(base, 'real.bin')
    writeFileSync(target, Buffer.alloc(10))
    try {
      symlinkSync(target, path.join(base, 'alias.bin'), 'file')
    } catch {
      ctx.skip() // file symlinks need Developer Mode or elevation
      return
    }

    const listing = await lister.list(base)

    expect(listing.entries.find((e) => e.name === 'alias.bin')).toMatchObject({
      isLink: true,
      size: 0,
    })
  })

  it('reports a missing folder as ENOENT and an empty listing', async () => {
    const listing = await lister.list(path.join(base, 'missing'))
    expect(listing).toEqual({ entries: [], errorCode: 'ENOENT' })
  })

  it('reports access denied', async (ctx) => {
    const protectedFolder = `${process.env['SystemDrive'] ?? 'C:'}\\System Volume Information`
    if (!existsSync(protectedFolder)) {
      ctx.skip()
      return
    }
    const listing = await lister.list(protectedFolder)
    if (listing.errorCode === null) {
      ctx.skip() // an elevated test run can read it
      return
    }
    expect(listing).toEqual({ entries: [], errorCode: 'EACCES' })
  })

  it('overlaps several listings', async () => {
    for (let i = 0; i < 8; i += 1) {
      const folder = path.join(base, `f${i}`)
      mkdirSync(folder)
      for (let j = 0; j <= i; j += 1)
        writeFileSync(path.join(folder, `file${j}.txt`), 'x'.repeat(j))
    }

    const listings = await Promise.all(
      Array.from({ length: 8 }, (_, i) => lister.list(path.join(base, `f${i}`))),
    )

    listings.forEach((listing, i) => {
      expect(listing.errorCode).toBeNull()
      expect(listing.entries.map((e) => e.name).sort()).toEqual(
        Array.from({ length: i + 1 }, (_, j) => `file${j}.txt`),
      )
      expect(listing.entries.map((e) => e.size).sort((x, y) => x - y)).toEqual(
        Array.from({ length: i + 1 }, (_, j) => j),
      )
    })
  })
})

describe.runIf(isWindows)('the Windows synchronous directory lister', () => {
  let base: string
  let sync: SyncLister
  let async: DirectoryLister

  beforeEach(async () => {
    base = mkdtempSync(path.join(os.tmpdir(), 'storageiq-sync-'))
    sync = await createWinFindSyncLister()
    async = await createWinFindLister()
  })

  afterEach(() => {
    rmSync(base, { recursive: true, force: true })
  })

  it('the sync lister lists a temp folder like the async lister', async () => {
    writeFileSync(path.join(base, 'a.txt'), 'hello')
    writeFileSync(path.join(base, 'b.bin'), '')
    mkdirSync(path.join(base, 'sub'))

    const fast = sync.listSync(base)
    const reference = await async.list(base)

    expect(fast.errorCode).toBeNull()
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
    expect([...fast.entries].sort(byName)).toEqual([...reference.entries].sort(byName))
    expect(fast.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'b.bin', 'sub'])
    expect(fast.entries.find((e) => e.name === 'sub')?.isDirectory).toBe(true)
    expect(fast.entries.find((e) => e.name === 'a.txt')?.size).toBe(5)
  })

  it('the sync lister reports ENOENT for a missing folder', () => {
    expect(sync.listSync(path.join(base, 'missing'))).toEqual({ entries: [], errorCode: 'ENOENT' })
  })

  it('the sync lister reports EACCES for a protected folder', (ctx) => {
    const protectedFolder = `${process.env['SystemDrive'] ?? 'C:'}\\System Volume Information`
    if (!existsSync(protectedFolder)) return ctx.skip()
    const listing = sync.listSync(protectedFolder)
    if (listing.errorCode === null) return ctx.skip()
    expect(listing).toEqual({ entries: [], errorCode: 'EACCES' })
  })

  it('the sync lister flags a junction as a link', (ctx) => {
    const target = path.join(base, 'target')
    mkdirSync(target)
    try {
      symlinkSync(target, path.join(base, 'junction'), 'junction')
    } catch {
      return ctx.skip()
    }
    const listing = sync.listSync(base)
    expect(listing.entries.find((e) => e.name === 'junction')).toMatchObject({
      isLink: true,
      size: 0,
    })
    expect(listing.entries.find((e) => e.name === 'target')?.isLink).toBe(false)
  })
})
