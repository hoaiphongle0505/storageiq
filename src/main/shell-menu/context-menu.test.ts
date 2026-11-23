import { describe, expect, it } from 'vitest'
import { chooseRoute, hideDestructiveVerbs, type MenuItemOps } from './context-menu'

describe('chooseRoute', () => {
  it('uses the single route for one path', () => {
    expect(chooseRoute(['D:\\Data\\a.txt'])).toBe('single')
  })

  it('uses one parent for paths in the same folder, ignoring case', () => {
    expect(chooseRoute(['D:\\Data\\a.txt', 'd:\\data\\B.txt'])).toBe('parent')
  })

  it('uses the default menu route when the parents differ', () => {
    expect(chooseRoute(['D:\\Data\\a.txt', 'D:\\Data\\Sub\\b.txt'])).toBe('default')
    expect(chooseRoute(['D:\\Data\\Sub', 'D:\\Data\\Sub\\b.txt'])).toBe('default')
    expect(chooseRoute(['D:\\a.txt', 'E:\\a.txt'])).toBe('default')
  })
})

describe('hideDestructiveVerbs', () => {
  it('removes only delete, cut and rename of the shell items, last first', () => {
    const items: Array<{ id: number; verb?: string | null }> = [
      { id: 0 }, // StorageIQ submenu
      { id: 0x100, verb: 'open' },
      { id: 0x101, verb: 'cut' },
      { id: 0x102, verb: 'copy' },
      { id: 0x103, verb: 'Delete' },
      { id: 0x104, verb: 'rename' },
      { id: 0x105, verb: null },
      { id: 4 }, // a StorageIQ item below the shell range
    ]
    const ops: MenuItemOps = {
      count: () => items.length,
      idAt: (position) => items[position]?.id ?? 0,
      verbOf: (offset) => items.find((item) => item.id === 0x100 + offset)?.verb ?? null,
      removeAt: (position) => {
        items.splice(position, 1)
      },
    }
    expect(hideDestructiveVerbs(ops)).toBe(3)
    expect(items.map((item) => item.id)).toEqual([0, 0x100, 0x102, 0x105, 4])
  })
})
