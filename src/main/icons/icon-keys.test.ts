import { describe, expect, it } from 'vitest'
import { ICON_TYPE_KEY_PATTERN } from '../ipc/parse-args'
import {
  folderKeyFor,
  iconKeyFor,
  isPerFileExtension,
  parseTypeKey,
  PER_FILE_EXTENSIONS,
  typeKeyOf,
} from './icon-keys'

describe('typeKeyOf', () => {
  it('maps folders, drive roots, extensions and extensionless files', () => {
    expect(typeKeyOf({ kind: 'folder', name: 'Photos' }, false)).toBe('dir')
    expect(typeKeyOf({ kind: 'folder', name: 'v1.2' }, false)).toBe('dir')
    expect(typeKeyOf({ kind: 'folder', name: 'D:\\' }, true)).toBe('drive')
    expect(typeKeyOf({ kind: 'file', name: 'Report.TXT' }, false)).toBe('ext:txt')
    expect(typeKeyOf({ kind: 'file', name: 'archive.tar.gz' }, false)).toBe('ext:gz')
    expect(typeKeyOf({ kind: 'file', name: 'README' }, false)).toBe('file')
    expect(typeKeyOf({ kind: 'file', name: '.gitignore' }, false)).toBe('file')
    expect(typeKeyOf({ kind: 'file', name: 'ends.' }, false)).toBe('file')
  })

  it('extensions are lower-cased and only [a-z0-9_$~-] up to 16 characters are accepted', () => {
    expect(typeKeyOf({ kind: 'file', name: 'a.MP4' }, false)).toBe('ext:mp4')
    expect(typeKeyOf({ kind: 'file', name: 'a.' + 'x'.repeat(16) }, false)).toBe(
      `ext:${'x'.repeat(16)}`,
    )
    expect(typeKeyOf({ kind: 'file', name: 'a.' + 'x'.repeat(17) }, false)).toBe('file')
    expect(typeKeyOf({ kind: 'file', name: 'a.b c' }, false)).toBe('file')
    expect(typeKeyOf({ kind: 'file', name: 'a.é' }, false)).toBe('file')
    expect(typeKeyOf({ kind: 'file', name: 'a.t~p$_-' }, false)).toBe('ext:t~p$_-')
    for (const name of ['a.txt', 'b.7z', 'c.t~p']) {
      expect(typeKeyOf({ kind: 'file', name }, false)).toMatch(ICON_TYPE_KEY_PATTERN)
    }
  })
})

describe('iconKeyFor', () => {
  it('exe, lnk, ico and url use per-file keys that differ per path and carry no path text', () => {
    expect([...PER_FILE_EXTENSIONS].sort()).toEqual(
      ['.cpl', '.exe', '.ico', '.lnk', '.msi', '.scr', '.url'].sort(),
    )
    const a = iconKeyFor('ext:exe', 'C:\\Secret\\a.exe')
    const b = iconKeyFor('ext:exe', 'C:\\Secret\\b.exe')
    expect(a).toMatch(/^f:[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
    expect(a.toLowerCase()).not.toContain('secret')
    expect(iconKeyFor('ext:lnk', 'C:\\x\\a.lnk')).toMatch(/^f:/)
    expect(iconKeyFor('ext:ico', 'C:\\x\\a.ico')).toMatch(/^f:/)
    expect(iconKeyFor('ext:url', 'C:\\x\\a.url')).toMatch(/^f:/)
    expect(iconKeyFor('ext:txt', null)).toBe('ext:txt')
    expect(iconKeyFor('dir', null)).toBe('dir')
    expect(iconKeyFor('file', null)).toBe('file')
    expect(isPerFileExtension('ext:exe')).toBe(true)
    expect(isPerFileExtension('ext:txt')).toBe(false)
    expect(isPerFileExtension('dir')).toBe(false)
  })

  it('per-file keys are stable for the same path in any letter case', () => {
    expect(iconKeyFor('ext:exe', 'C:\\Tools\\App.EXE')).toBe(
      iconKeyFor('ext:exe', 'c:\\tools\\app.exe'),
    )
  })

  it('a drive root gets its own key per letter', () => {
    expect(iconKeyFor('drive', 'C:\\')).toBe('drive:c')
    expect(iconKeyFor('drive', 'e:\\')).toBe('drive:e')
    expect(iconKeyFor('drive', null)).toBe('drive')
  })
})

describe('folderKeyFor', () => {
  const known = new Set(['c:\\users\\ana', 'c:\\users\\ana\\downloads'])

  it('gives a known folder a per-path key and every other folder the generic dir key', () => {
    expect(folderKeyFor('C:\\Users\\Ana\\Downloads', known)).toMatch(/^f:[0-9a-f]{12}$/)
    expect(folderKeyFor('c:\\users\\ana\\downloads\\', known)).toBe(
      folderKeyFor('C:\\Users\\Ana\\Downloads', known),
    )
    expect(folderKeyFor('C:\\Users\\Ana', known)).toMatch(/^f:/)
    expect(folderKeyFor('C:\\Users\\Ana\\Downloads\\Sub', known)).toBe('dir')
    expect(folderKeyFor('D:\\Data', known)).toBe('dir')
    expect(folderKeyFor('D:\\Data', new Set())).toBe('dir')
  })
})

describe('parseTypeKey', () => {
  it('parses dir, drive, file and ext keys', () => {
    expect(parseTypeKey('dir')).toEqual({ kind: 'dir' })
    expect(parseTypeKey('file')).toEqual({ kind: 'file', ext: '' })
    expect(parseTypeKey('ext:txt')).toEqual({ kind: 'file', ext: 'txt' })
    expect(parseTypeKey('drive')).toEqual({
      kind: 'path',
      path: `${process.env['SystemDrive'] ?? 'C:'}\\`,
    })
  })

  it('parseTypeKey rejects anything that is not dir, drive, file or ext:<safe>', () => {
    for (const key of [
      'C:\\Windows',
      'ext:.txt',
      'ext:a/b',
      'ext:TXT',
      'f:0123456789ab',
      'drive:c',
      '',
      'ext:',
    ]) {
      expect(() => parseTypeKey(key)).toThrow()
    }
  })
})
