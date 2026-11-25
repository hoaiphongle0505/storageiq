import { useEffect, useId, useState } from 'react'
import type { OptionsState } from '@shared/ipc-contract'
import { useWorkspace } from '../stores/workspace-store-context'
import { Group } from './RibbonGroup'

const UNAVAILABLE_TEXT = 'Available in the installed app'
const CHANGE_FAILED_TEXT = 'Windows did not allow that change. Your settings are unchanged.'
const READ_FAILED_TEXT = 'StorageIQ could not read the Windows settings.'
const RESTART_TEXT = 'Takes effect the next time StorageIQ starts'

const MENU_LABEL = 'Show StorageIQ in Explorer’s context menu'
const MENU_TITLE =
  'Adds “Scan with StorageIQ” when you right-click a folder, a drive or the empty space in a folder'
const ADMIN_LABEL = 'Always start StorageIQ as administrator'
const ADMIN_TITLE =
  'Windows asks for approval each time StorageIQ starts, so it can read protected folders'
const ADMIN_LOCKED_TITLE = 'Set for all users by your administrator'

const CHECKBOX_CLASS = 'size-4 shrink-0 accent-accent disabled:opacity-60'
const LABEL_CLASS = 'flex items-center gap-2 text-[13px] leading-[18px] text-ink'

/**
 * The Options tab's “Application” group. It shows what Windows has (read again each time the tab
 * is shown); nothing is kept in StorageIQ's own settings.
 */
export function OptionsGroup() {
  const loadOptionsState = useWorkspace((s) => s.loadOptionsState)
  const changeExplorerMenu = useWorkspace((s) => s.changeExplorerMenu)
  const changeRunAsAdmin = useWorkspace((s) => s.changeRunAsAdmin)
  const [state, setState] = useState<OptionsState | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [restartNote, setRestartNote] = useState(false)
  const captionId = useId()

  useEffect(() => {
    let current = true
    void loadOptionsState().then((loaded) => {
      if (!current) return
      if (loaded === null) setMessage(READ_FAILED_TEXT)
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

  const available = state?.available === true
  const locked = state?.runAsAdminLocked === true
  const describedBy = state !== null && !available ? captionId : undefined

  return (
    <Group label="Application">
      <div className="flex w-80 flex-col gap-1 p-1.5">
        <label title={MENU_TITLE} className={LABEL_CLASS}>
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={state?.explorerMenu === true}
            disabled={!available || busy}
            aria-describedby={describedBy}
            onChange={(event) => void change('menu', event.target.checked)}
          />
          {MENU_LABEL}
        </label>
        <label title={locked ? ADMIN_LOCKED_TITLE : ADMIN_TITLE} className={LABEL_CLASS}>
          <input
            type="checkbox"
            className={CHECKBOX_CLASS}
            checked={state?.runAsAdmin === true}
            disabled={!available || busy || locked}
            aria-describedby={describedBy}
            onChange={(event) => void change('admin', event.target.checked)}
          />
          {ADMIN_LABEL}
        </label>
        <div aria-live="polite" className="text-xs leading-4 text-ink-muted">
          {restartNote && <p className="pl-6">{RESTART_TEXT}</p>}
        </div>
        {state !== null && !available && (
          <p id={captionId} className="text-xs leading-4 text-ink-muted">
            {UNAVAILABLE_TEXT}
          </p>
        )}
        <p role="status" className="text-xs leading-4 text-danger">
          {message}
        </p>
      </div>
    </Group>
  )
}
