import { describe, expect, it } from 'vitest'
import { recycleBinRootOf } from './recycle-bin'

describe('recycleBinRootOf', () => {
  it.each([
    ['C:\\$RECYCLE.BIN', 'C:\\'],
    ['c:\\$recycle.bin', 'C:\\'],
    ['D:\\$Recycle.Bin\\', 'D:\\'],
    ['D:\\$RECYCLE.BIN\\S-1-5-21-111-222-333-1001', 'D:\\'],
    ['e:\\$recycle.bin\\S-1-5-18\\', 'E:\\'],
  ])('%s is a Recycle Bin folder of %s', (target, root) => {
    expect(recycleBinRootOf(target)).toBe(root)
  })

  it.each([
    'C:\\',
    'C:\\Data',
    'C:\\Data\\$RECYCLE.BIN',
    'C:\\$RECYCLE.BIN\\S-1-5-21\\$I123.txt',
    'C:\\$RECYCLE.BIN\\S-1-5-21\\sub\\deeper',
    'C:\\$RECYCLE.BINX',
    'C:\\X$RECYCLE.BIN',
    '\\\\server\\share\\$RECYCLE.BIN',
    '$RECYCLE.BIN',
    '',
  ])('%s is not', (target) => {
    expect(recycleBinRootOf(target)).toBeNull()
  })
})
