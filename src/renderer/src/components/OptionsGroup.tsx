import { useEffect, useId, useState } from 'react'
import type { OptionsState } from '@shared/ipc-contract'
import { useWorkspace } from '../stores/workspace-store-context'
import { Group } from './RibbonGroup'

const UNAVAILABLE_TEXT = 'Available in the installed app'
const READ_FAILED_TEXT = 'Could not read this setting'
const CHANGE_FAILED_TEXT = 'Windows did not allow that change. Your settings are unchanged.'
const RESTART_TEXT = 'Takes effect the next time StorageIQ starts'

const MENU_LABEL = 'Show StorageIQ in Explorer’s context menu'
const MENU_NOTE = 'Adds “Scan with StorageIQ” to right-click menus'
const MENU_TITLE =
  'Adds “Scan with StorageIQ” when you right-click a folder, a drive or the empty space in a folder'
const ADMIN_LABEL = 'Always start StorageIQ as administrator'
const ADMIN_NOTE =
  'Windows asks for approval each time StorageIQ starts. While it runs as administrator, Explorer menu commands run as administrator too: Delete asks for no permission, and Open runs a program as administrator.'
const ADMIN_TITLE =
  'Windows asks for approval each time StorageIQ starts, so it can read protected folders'
const ADMIN_LOCKED_NOTE = 'Set for all users by your administrator'

const CHECKBOX_CLASS = 'size-4 shrink-0 accent-accent disabled:opacity-60'
const LABEL_CLASS = 'flex items-center gap-2 text-[13px] leading-[18px] text-ink'
const NOTE_CLASS = 'pl-6 text-xs leading-4 text-ink-muted'

/**
 * The Options tab's “Application” group. It shows what Windows has (read again each time the tab
 * is shown); nothing is kept in StorageIQ's own settings. Every explanation is visible text that
 * the checkbox points to with aria-describedby, not only a tooltip.
 */
export function OptionsGroup() {
  const loadOptionsState = useWorkspace((s) => s.loadOptionsState)
  const changeExplorerMenu = useWorkspace((s) => s.changeExplorerMenu)
  const changeRunAsAdmin = useWorkspace((s) => s.changeRunAsAdmin)
  const [state, setState] = useState<OptionsState | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [restartNote, setRestartNote] = useState(false)
  const baseId = useId()
  const menuNoteId = `${baseId}-menu`
  const adminNoteId = `${baseId}-admin`
  const stateNoteId = `${baseId}-state`

  useEffect(() => {
    let current = true
    void loadOptionsState().then((loaded) => {
      if (!current) return
      if (loaded === null) setLoadFailed(true)
      else setState(loaded)
    })
    return () => {
      current = false
    }
  }, [loadOptionsState])

  const change = async (which: 'menu' | 'admin', enabled: boolean) => {
    setBusy(true)
    setMessage('')
    const result = await (which === 'menu'
      ? changeExplorerMenu(enabled)
      : changeRunAsAdmin(enabled))
    setBusy(false)
    if (result === null) {
      setMessage(CHANGE_FAILED_TEXT)
      return
    }
    setState(result.state)
    if (result.error !== null) {
      setMessage(result.error)
    } else if (which === 'admin') {
      setRestartNote(true)
    }
  }

  const readFailed = loadFailed || state?.readFailed === true
  const available = state?.available === true && !readFailed
  const locked = state?.runAsAdminLocked === true
  // One note for the whole group when the switches cannot be used; otherwise one per switch.
  const stateNote = readFailed
    ? READ_FAILED_TEXT
    : state !== null && !available
      ? UNAVAILABLE_TEXT
      : null

  return (
    <Group label="Application">
      <div className="grid w-[40rem] grid-cols-2 gap-x-4 gap-y-0.5 p-1">
        <label title={MENU_TITLE} className={LABEL_CLASS}>
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={available && state?.explorerMenu === true}
            disabled={!available || busy}
            aria-describedby={stateNote !== null ? stateNoteId : menuNoteId}
            onChange={(event) => void change('menu', event.target.checked)}
          />
          {MENU_LABEL}
        </label>
        <label title={locked ? ADMIN_LOCKED_NOTE : ADMIN_TITLE} className={LABEL_CLASS}>
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={available && state?.runAsAdmin === true}
            disabled={!available || busy || locked}
            aria-describedby={stateNote !== null ? stateNoteId : adminNoteId}
            onChange={(event) => void change('admin', event.target.checked)}
          />
          {ADMIN_LABEL}
        </label>
        {stateNote !== null ? (
          <p id={stateNoteId} className={`col-span-2 ${NOTE_CLASS}`}>
            {stateNote}
          </p>
        ) : (
          <>
            <p id={menuNoteId} className={NOTE_CLASS}>
              {MENU_NOTE}
            </p>
            <div aria-live="polite">
              <p id={adminNoteId} className={NOTE_CLASS}>
                {locked ? ADMIN_LOCKED_NOTE : ADMIN_NOTE}
              </p>
              {restartNote && <p className={NOTE_CLASS}>{RESTART_TEXT}</p>}
            </div>
          </>
        )}
        <p role="status" className="col-span-2 text-xs leading-4 text-danger">
          {message}
        </p>
      </div>
    </Group>
  )
}
