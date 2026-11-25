import { describe, expect, it, vi } from 'vitest'
import {
  createRecentScans,
  listPlaces,
  oneDriveFolders,
  parseRecent,
  type RecentScans,
} from './places'

const FILE = 'C:\\Users\\Ana\\AppData\\Roaming\\StorageIQ\\recent-scans.json'

function memoryRecent(initial = '[]') {
  let stored = initial
  const writeFile = vi.fn(async (_file: string, text: string) => {
    stored = text
  })
  const recent = createRecentScans({
    file: FILE,
    readFile: async () => stored,
    writeFile,
  })
  return { recent, writeFile, stored: () => stored }
}

describe('oneDriveFolders', () => {
  it('reads the OneDrive environment variables, personal first, without duplicates', () => {
    expect(
      oneDriveFolders({
        OneDrive: 'C:\\Users\\Ana\\OneDrive - Contoso',
        OneDriveConsumer: 'C:\\Users\\Ana\\OneDrive',
        OneDriveCommercial: 'C:\\Users\\Ana\\OneDrive - Contoso',
      }),
    ).toEqual([
      { kind: 'onedrive', label: 'OneDrive', path: 'C:\\Users\\Ana\\OneDrive' },
      {
        kind: 'onedrive',
        label: 'OneDrive - Contoso',
        path: 'C:\\Users\\Ana\\OneDrive - Contoso',
      },
    ])
  })

  it('ignores missing, relative and network values', () => {
    expect(oneDriveFolders({})).toEqual([])
    expect(oneDriveFolders({ OneDrive: 'OneDrive', OneDriveCommercial: '\\\\srv\\od' })).toEqual([])
  })
})

describe('listPlaces', () => {
  it('lists Documents and OneDrive folders that exist, plus the recent scans', async () => {
    const recent: RecentScans = { list: async () => ['D:\\Photos'], add: async () => undefined }
    const places = await listPlaces({
      documentsPath: () => 'C:\\Users\\Ana\\Documents',
      env: { OneDriveConsumer: 'C:\\Users\\Ana\\OneDrive', OneDrive: 'C:\\Users\\Ana\\Gone' },
      isDirectory: async (target) => !target.endsWith('Gone'),
      recent,
    })
    expect(places).toEqual({
      places: [
        { kind: 'documents', label: 'Documents', path: 'C:\\Users\\Ana\\Documents' },
        { kind: 'onedrive', label: 'OneDrive', path: 'C:\\Users\\Ana\\OneDrive' },
      ],
      recent: ['D:\\Photos'],
    })
  })

  it('leaves Documents out when Windows has none', async () => {
    const places = await listPlaces({
      documentsPath: () => null,
      env: {},
      isDirectory: async () => true,
      recent: { list: async () => [], add: async () => undefined },
    })
    expect(places).toEqual({ places: [], recent: [] })
  })
})

describe('recent scans', () => {
  it('starts empty and keeps the newest five, most recent first', async () => {
    const { recent } = memoryRecent()
    expect(await recent.list()).toEqual([])
    for (const target of ['A:\\', 'B:\\', 'C:\\', 'D:\\', 'E:\\', 'F:\\']) await recent.add(target)
    expect(await recent.list()).toEqual(['F:\\', 'E:\\', 'D:\\', 'C:\\', 'B:\\'])
  })

  it('moves a path scanned again to the top, whatever its letter case', async () => {
    const { recent } = memoryRecent(JSON.stringify(['D:\\Photos', 'C:\\Data']))
    await recent.add('c:\\data')
    expect(await recent.list()).toEqual(['c:\\data', 'D:\\Photos'])
  })

  it('applies adds in order', async () => {
    const { recent } = memoryRecent()
    await Promise.all([recent.add('C:\\One'), recent.add('C:\\Two')])
    expect(await recent.list()).toEqual(['C:\\Two', 'C:\\One'])
  })

  it('survives a missing or broken file', async () => {
    const recent = createRecentScans({
      file: FILE,
      readFile: async () => {
        throw new Error('ENOENT')
      },
      writeFile: async () => undefined,
    })
    expect(await recent.list()).toEqual([])
    expect(parseRecent('{not json')).toEqual([])
    expect(parseRecent('{"a":1}')).toEqual([])
    expect(parseRecent('["C:\\\\Ok", 5, "relative", "\\\\\\\\srv\\\\share"]')).toEqual(['C:\\Ok'])
  })
})
