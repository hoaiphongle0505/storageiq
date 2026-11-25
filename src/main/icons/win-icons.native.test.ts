import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { IconImage } from '@shared/ipc-contract'
import { iconKeyFor, type NativeTarget } from './icon-keys'
import { createIconService, type IconService, type IconWorkerLike } from './icon-service'
import { ICON_WORKER_DATA } from './icon-worker-protocol'
import { inflateSync } from 'node:zlib'

/**
 * Native tests of the icon worker thread (Windows only), through the real service and a real
 * worker built the way electron.vite.config.ts builds it. Nothing is created on disk except under
 * `os.tmpdir()/storageiq-t12-<random>`; only that folder is deleted afterwards.
 */
const onWindows = process.platform === 'win32'

const bundleDir = path.resolve('out', 'test-icon-worker')
let workRoot = ''
let service: IconService

async function buildWorkerBundle(): Promise<string> {
  await build({
    configFile: false,
    logLevel: 'warn',
    resolve: { alias: { '@shared': path.resolve('src/shared') } },
    build: {
      ssr: path.resolve('src/main/icons/icon-worker.ts'),
      outDir: bundleDir,
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      rolldownOptions: { output: { format: 'cjs', entryFileNames: 'icon-worker.js' } },
    },
  })
  return path.join(bundleDir, 'icon-worker.js')
}

/** Width, height and RGBA alpha bytes of a `data:image/png;base64,…` URL. */
function decode(url: string): { width: number; height: number; alphas: number[] } {
  expect(url.startsWith('data:image/png;base64,')).toBe(true)
  const png = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  expect(png[25]).toBe(6)
  const idat: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    if (png.toString('latin1', offset + 4, offset + 8) === 'IDAT') {
      idat.push(png.subarray(offset + 8, offset + 8 + length))
    }
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const alphas: number[] = []
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) alphas.push(raw[y * (width * 4 + 1) + 1 + x * 4 + 3] ?? 0)
  }
  return { width, height, alphas }
}

async function fetchOne(key: string, target: NativeTarget): Promise<IconImage> {
  const { images } = await service.request([{ key, target }])
  const image = images[key]
  if (image === undefined) throw new Error(`no icon for ${key}`)
  return image
}

/** The checks every icon must pass; returns the measured pixel sizes. */
function expectIcon(image: IconImage): { small: number; large: number } {
  const small = decode(image.small)
  const large = decode(image.large)
  expect(small.width).toBe(small.height)
  expect(large.width).toBe(large.height)
  expect(small.width).toBeGreaterThanOrEqual(16)
  expect(small.width).toBeLessThanOrEqual(24)
  expect(large.width).toBeGreaterThanOrEqual(32)
  expect(large.width).toBeLessThanOrEqual(48)
  for (const { alphas } of [small, large]) {
    expect(alphas.some((alpha) => alpha > 0)).toBe(true)
    expect(alphas.some((alpha) => alpha === 255)).toBe(true)
  }
  return { small: small.width, large: large.width }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const systemDrive = `${process.env['SystemDrive'] ?? 'C:'}\\`
const notepad = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'notepad.exe')

/** GDI objects of this process (the icon worker is a thread of it). */
async function gdiObjects(): Promise<() => number> {
  const { default: koffi } = await import('koffi')
  const GetGuiResources = koffi
    .load('user32.dll')
    .func('uint32_t __stdcall GetGuiResources(void *process, uint32_t flags)')
  const GetCurrentProcess = koffi.load('kernel32.dll').func('void * __stdcall GetCurrentProcess()')
  return () => Number(GetGuiResources(GetCurrentProcess(), 0)) // GR_GDIOBJECTS
}

const manyTargets = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, i) => {
    const kinds: NativeTarget[] = [
      { kind: 'file', ext: `${prefix}${i}` },
      { kind: 'dir' },
      { kind: 'path', path: path.join(workRoot, `missing-${prefix}${i}.exe`) },
    ]
    const target = kinds[i % 3] as NativeTarget
    // A distinct key per lookup, so the service cache never answers instead of the shell.
    return { key: `${i % 3 === 0 ? 'ext:' : 'f:'}${prefix}${i}`, target }
  })

describe.skipIf(!onWindows)('the icon worker thread (native)', () => {
  beforeAll(async () => {
    const script = await buildWorkerBundle()
    workRoot = mkdtempSync(path.join(os.tmpdir(), 'storageiq-t12-'))
    service = createIconService({
      spawn: () =>
        new Worker(script, { workerData: ICON_WORKER_DATA }) as unknown as IconWorkerLike,
      schedule: (callback, ms) => {
        const timer = setTimeout(callback, ms)
        timer.unref()
        return () => clearTimeout(timer)
      },
      now: Date.now,
      maxEntries: 512,
      maxPathKeys: 4096,
    })
  }, 120_000)

  afterAll(() => {
    service?.dispose()
    if (workRoot.includes('storageiq-t12-')) rmSync(workRoot, { recursive: true, force: true })
    rmSync(bundleDir, { recursive: true, force: true })
  })

  it('fetches the icon for .txt by extension without the file existing', async () => {
    const image = await fetchOne('ext:txt', { kind: 'file', ext: 'txt' })
    const sizes = expectIcon(image)
    console.info(
      `[icons] .txt sizes at this machine's scaling: small ${sizes.small}, large ${sizes.large}`,
    )
  }, 60_000)

  it('fetches the folder icon', async () => {
    const folder = await fetchOne('dir', { kind: 'dir' })
    expectIcon(folder)
    const text = await fetchOne('ext:txt', { kind: 'file', ext: 'txt' })
    expect(folder.small).not.toBe(text.small)
  }, 60_000)

  it('fetches the drive icon for the system drive', async () => {
    expectIcon(await fetchOne('drive:sys', { kind: 'path', path: systemDrive }))
  }, 60_000)

  it('fetches the folder icon of a known folder (Downloads) with a real lookup', async () => {
    const { knownFolders } = service
    const known = [...(await knownFolders())]
    const downloads = known.find((folder) => folder.endsWith('\\downloads'))
    expect(known.length).toBeGreaterThanOrEqual(5)
    expect(downloads).toBeDefined()
    expectIcon(await fetchOne('f:downloads', { kind: 'path', path: downloads ?? '' }))
  }, 60_000)

  it('fetches a real .exe icon per file', async () => {
    const key = iconKeyFor('ext:exe', process.execPath)
    expect(key.startsWith('f:')).toBe(true)
    expectIcon(await fetchOne(key, { kind: 'path', path: process.execPath }))
  }, 60_000)

  it.skipIf(!existsSync(notepad))(
    'two .exe files with different icons yield different images',
    async () => {
      const node = await fetchOne(iconKeyFor('ext:exe', process.execPath), {
        kind: 'path',
        path: process.execPath,
      })
      const other = await fetchOne(iconKeyFor('ext:exe', notepad), { kind: 'path', path: notepad })
      expect(other.small).not.toBe(node.small)
    },
    60_000,
  )

  it('a .lnk created in the temp folder gets its own icon', async () => {
    const link = path.join(workRoot, 'notepad-link.lnk')
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${link}'); $s.TargetPath = '${notepad}'; $s.Save()`,
      ],
      { stdio: 'ignore' },
    )
    try {
      const key = iconKeyFor('ext:lnk', link)
      expect(key.startsWith('f:')).toBe(true)
      const image = await fetchOne(key, { kind: 'path', path: link })
      expectIcon(image)
      const generic = await fetchOne('ext:lnk', { kind: 'file', ext: 'lnk' })
      expect(image.small).not.toBe(generic.small)
    } finally {
      rmSync(link, { force: true })
    }
  }, 60_000)

  it('a missing per-file path falls back to the extension icon', async () => {
    const missing = path.join(workRoot, 'not-there.exe')
    const image = await fetchOne('f:missing000000', { kind: 'path', path: missing })
    const generic = await fetchOne('ext:exe', { kind: 'file', ext: 'exe' })
    expectIcon(image)
    expect(image.small).toBe(generic.small)
  }, 60_000)

  it('does not leak GDI objects', async () => {
    const gdi = await gdiObjects()
    await service.request(manyTargets(30, 'warm')) // load the shell's icon machinery first
    const before = gdi()
    const started = performance.now()
    const batch = manyTargets(300, 'leak')
    const { images } = await service.request(batch)
    const elapsed = Math.round(performance.now() - started)
    expect(Object.keys(images).length).toBeGreaterThan(250)
    const after = gdi()
    console.info(`[icons] 300 lookups in ${elapsed} ms; GDI objects ${before} -> ${after}`)
    expect(after - before).toBeLessThanOrEqual(5)
  }, 120_000)

  it('does not block the event loop', async () => {
    let last = performance.now()
    let maxGap = 0
    const timer = setInterval(() => {
      const now = performance.now()
      maxGap = Math.max(maxGap, now - last)
      last = now
    }, 20)
    try {
      await sleep(100)
      last = performance.now()
      const started = performance.now()
      const { images } = await service.request(manyTargets(300, 'loop'))
      const elapsed = Math.round(performance.now() - started)
      expect(Object.keys(images).length).toBeGreaterThan(250)
      console.info(
        `[icons] 300 lookups in ${elapsed} ms; max event-loop gap ${Math.round(maxGap)} ms`,
      )
    } finally {
      clearInterval(timer)
    }
    expect(maxGap).toBeLessThanOrEqual(250)
  }, 120_000)
})
