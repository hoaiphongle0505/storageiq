import { describe, expect, it } from 'vitest'
import {
  classifyCommand,
  nextNewFolderName,
  plainMenuLabel,
  SHELL_FIRST_ID,
  SHELL_LAST_ID,
  STORAGEIQ_COMMAND_IDS,
  STORAGEIQ_MENU_LABELS,
  storageiqMenuLabels,
  verbChangesFileSystem,
} from './menu-commands'

describe('classifyCommand', () => {
  it('maps StorageIQ’s ids to its items', () => {
    expect(classifyCommand(STORAGEIQ_COMMAND_IDS.refresh)).toEqual({
      kind: 'storageiq',
      item: 'refresh',
    })
    expect(classifyCommand(2)).toEqual({ kind: 'storageiq', item: 'copy-path' })
    expect(classifyCommand(3)).toEqual({ kind: 'storageiq', item: 'open' })
    expect(classifyCommand(4)).toEqual({ kind: 'storageiq', item: 'new-folder' })
  })

  it('maps the shell’s id range to an offset from its first id', () => {
    expect(classifyCommand(SHELL_FIRST_ID)).toEqual({ kind: 'shell', offset: 0 })
    expect(classifyCommand(SHELL_FIRST_ID + 17)).toEqual({ kind: 'shell', offset: 17 })
    expect(classifyCommand(SHELL_LAST_ID)).toEqual({
      kind: 'shell',
      offset: SHELL_LAST_ID - SHELL_FIRST_ID,
    })
  })

  it.each([0, -1, 6, SHELL_FIRST_ID - 1, SHELL_LAST_ID + 1, 1.5])(
    'treats %d as no choice',
    (id) => {
      expect(classifyCommand(id)).toEqual({ kind: 'none' })
    },
  )

  it('keeps StorageIQ’s ids below the shell range', () => {
    for (const id of Object.values(STORAGEIQ_COMMAND_IDS)) expect(id).toBeLessThan(SHELL_FIRST_ID)
  })
})

describe('plainMenuLabel', () => {
  it('drops access keys and shortcut text', () => {
    expect(plainMenuLabel(STORAGEIQ_MENU_LABELS['new-folder'])).toBe('New folder')
    expect(plainMenuLabel('P&roperties')).toBe('Properties')
    expect(plainMenuLabel('Copy &as path')).toBe('Copy as path')
    expect(plainMenuLabel('Fish && chips')).toBe('Fish & chips')
  })
})

describe('verbChangesFileSystem', () => {
  it.each(['delete', 'cut', 'rename', 'paste', 'undelete', 'link', 'Some3rdParty'])(
    '%s may change files',
    (verb) => {
      expect(verbChangesFileSystem(verb)).toBe(true)
    },
  )

  it('treats a command without a verb as a change', () => {
    expect(verbChangesFileSystem(null)).toBe(true)
  })

  it.each(['open', 'Properties', 'copy', 'copyaspath', 'pintohome', 'explore', 'runas'])(
    '%s only reads',
    (verb) => {
      expect(verbChangesFileSystem(verb)).toBe(false)
    },
  )
})

describe('nextNewFolderName', () => {
  it('follows Windows’ numbering and ignores letter case', () => {
    expect(nextNewFolderName([])).toBe('New folder')
    expect(nextNewFolderName(['a.txt'])).toBe('New folder')
    expect(nextNewFolderName(['new FOLDER'])).toBe('New folder (2)')
    expect(nextNewFolderName(['New folder', 'New folder (2)', 'New folder (4)'])).toBe(
      'New folder (3)',
    )
  })
})

describe('storageiqMenuLabels', () => {
  it('offers four items for one row and Refresh plus Copy paths for several', () => {
    expect(storageiqMenuLabels(1, true).map((entry) => entry.item)).toEqual([
      'refresh',
      'copy-path',
      'open',
      'new-folder',
    ])
    expect(storageiqMenuLabels(1, true).find((e) => e.item === 'copy-path')?.label).toBe(
      '&Copy path',
    )
    const several = storageiqMenuLabels(3, false)
    expect(several.map((entry) => entry.item)).toEqual(['refresh', 'copy-path'])
    expect(several.find((e) => e.item === 'copy-path')?.label).toBe('&Copy paths')
    expect(storageiqMenuLabels(3, true).map((e) => e.item)).toEqual(['refresh', 'copy-path'])
  })
})

describe('delete command', () => {
  it('is classified as a StorageIQ command with id 5', () => {
    expect(STORAGEIQ_COMMAND_IDS.delete).toBe(5)
    expect(classifyCommand(5)).toEqual({ kind: 'storageiq', item: 'delete' })
    expect(STORAGEIQ_MENU_LABELS.delete).toBe('Delete (move to &Recycle Bin)')
  })
})
