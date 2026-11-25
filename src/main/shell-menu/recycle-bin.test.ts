import { describe, expect, it } from 'vitest'
import {
  assertDriveRoot,
  isBenignEmptyBinResult,
  isDriveRoot,
  recycleBinRootOf,
} from './recycle-bin'

const SID = 'S-1-5-21-111-222-333-1001'

describe('recycleBinRootOf', () => {
  it.each([
    ['C:\\$RECYCLE.BIN', 'C:\\'],
    ['c:\\$recycle.bin', 'C:\\'],
    ['D:\\$Recycle.Bin\\', 'D:\\'],
    [`D:\\$RECYCLE.BIN\\${SID}`, 'D:\\'],
    [`e:\\$recycle.bin\\${SID.toLowerCase()}\\`, 'E:\\'],
  ])('%s is the bin or the current user folder of %s', (target, root) => {
    expect(recycleBinRootOf(target, SID)).toBe(root)
  })

  it.each([
    'C:\\',
    'C:\\Data',
    'C:\\Data\\$RECYCLE.BIN',
    // another user's folder, a file and a non-SID folder directly in the bin
    'D:\\$RECYCLE.BIN\\S-1-5-21-111-222-333-1002',
    'D:\\$RECYCLE.BIN\\desktop.ini',
    'D:\\$RECYCLE.BIN\\Backup',
    `C:\\$RECYCLE.BIN\\${SID}\\$I123.txt`,
    `C:\\$RECYCLE.BIN\\${SID}\\sub\\deeper`,
    `C:\\$RECYCLE.BIN\\${SID}1`,
    'C:\\$RECYCLE.BINX',
    'C:\\X$RECYCLE.BIN',
    '\\\\server\\share\\$RECYCLE.BIN',
    '$RECYCLE.BIN',
    '',
  ])('%s is not', (target) => {
    expect(recycleBinRootOf(target, SID)).toBeNull()
  })

  it('without a known user SID only the bin folder itself counts', () => {
    expect(recycleBinRootOf('D:\\$RECYCLE.BIN', null)).toBe('D:\\')
    expect(recycleBinRootOf(`D:\\$RECYCLE.BIN\\${SID}`, null)).toBeNull()
  })
})

describe('isDriveRoot', () => {
  it.each(['C:\\', 'z:\\'])('%s is a drive root', (root) => {
    expect(isDriveRoot(root)).toBe(true)
  })
  it.each(['', 'C:', 'C:\\x', '\\\\s\\h', 'CC:\\', 'C:\\\n'])('%j is not', (root) => {
    expect(isDriveRoot(root)).toBe(false)
  })
})

describe('assertDriveRoot and isBenignEmptyBinResult', () => {
  it('assertDriveRoot throws for anything but a drive root', () => {
    expect(() => assertDriveRoot('')).toThrow()
    expect(() => assertDriveRoot('C:\\')).not.toThrow()
  })

  it('treats success, an empty bin and a cancel as benign and a real failure as not', () => {
    for (const hr of [0, 1, 0x8000ffff, 0x800704c7, 0x80004004]) {
      expect(isBenignEmptyBinResult(hr)).toBe(true)
      expect(isBenignEmptyBinResult(hr | 0)).toBe(true)
    }
    expect(isBenignEmptyBinResult(0x80070005)).toBe(false)
    expect(isBenignEmptyBinResult(0x80004005)).toBe(false)
  })
})
