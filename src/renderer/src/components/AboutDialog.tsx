import { useState } from 'react'
import { useAppStore } from '../stores/app-store-context'
import { useWorkspace } from '../stores/workspace-store-context'
import { AppLogo } from './AppLogo'
import { Button } from './Button'
import { Dialog } from './Dialog'
import { downloadingText, UpdateProgress } from './UpdateProgress'

const NOTICES_MISSING = 'The notices file was not found.'

/** The About window: identity, versions, the update block and the project links. */
export function AboutDialog({ onClose }: { onClose(): void }) {
  const appInfo = useAppStore((s) => s.appInfo)
  const updateState = useWorkspace((s) => s.updateState)
  const checkForUpdates = useWorkspace((s) => s.checkForUpdates)
  const downloadUpdate = useWorkspace((s) => s.downloadUpdate)
  const installUpdate = useWorkspace((s) => s.installUpdate)
  const openWhatsNew = useWorkspace((s) => s.openWhatsNew)
  const openLink = useWorkspace((s) => s.openLink)
  const openNotices = useWorkspace((s) => s.openNotices)
  const [noticeMessage, setNoticeMessage] = useState('')

  const state = updateState
  const checkButton = (
    <Button
      variant="secondary"
      busy={state.kind === 'checking'}
      onClick={() => void checkForUpdates()}
    >
      Check for updates
    </Button>
  )

  return (
    <Dialog title="About StorageIQ" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <AppLogo size={64} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-display text-lg leading-6 font-semibold text-ink">StorageIQ</p>
            <p className="flex items-center gap-2 text-sm text-ink">
              Version {appInfo?.version ?? ''}
              {appInfo !== null && (
                <span className="rounded-pill border border-line px-2 text-xs leading-5 text-ink-muted">
                  {appInfo.channel}
                </span>
              )}
            </p>
            {appInfo !== null && (
              <p className="text-xs text-ink-muted">
                Electron {appInfo.electronVersion}, Chromium {appInfo.chromeVersion}
              </p>
            )}
          </div>
        </div>
        <p className="text-ink-muted">
          Shows where your disk space went. Free and open source under the MIT license.
        </p>

        <div role="status" className="flex flex-wrap items-center gap-3">
          {state.kind === 'checking' && <p className="text-sm">Checking for updates…</p>}
          {state.kind === 'up-to-date' && <p className="text-sm">You have the latest version.</p>}
          {(state.kind === 'unavailable' || state.kind === 'error') && (
            <p className="text-sm">{state.message}</p>
          )}
          {state.kind === 'available' && (
            <p className="text-sm">StorageIQ {state.version} is available.</p>
          )}
          {state.kind === 'downloading' && (
            <>
              <p className="text-sm">{downloadingText(state.version, state.percent)}</p>
              <UpdateProgress percent={state.percent} />
            </>
          )}
          {state.kind === 'ready' && <p className="text-sm">StorageIQ {state.version} is ready.</p>}
          {noticeMessage !== '' && <p className="text-sm">{noticeMessage}</p>}

          {(state.kind === 'idle' ||
            state.kind === 'checking' ||
            state.kind === 'up-to-date' ||
            state.kind === 'unavailable' ||
            state.kind === 'error') &&
            checkButton}
          {state.kind === 'available' && (
            <>
              <Button onClick={() => void downloadUpdate()}>Update</Button>
              <Button
                variant="quiet"
                onClick={() => {
                  onClose()
                  openWhatsNew({ kind: 'update', version: state.version })
                }}
              >
                What&apos;s new
              </Button>
            </>
          )}
          {state.kind === 'ready' && (
            <Button onClick={() => void installUpdate()}>Restart to update</Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="quiet"
            onClick={() => {
              onClose()
              openWhatsNew({ kind: 'history' })
            }}
          >
            What&apos;s new
          </Button>
          <Button variant="quiet" onClick={() => void openLink('repo')}>
            GitHub repository
          </Button>
          <Button variant="quiet" onClick={() => void openLink('license')}>
            MIT licence
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              void openNotices().then((opened) => setNoticeMessage(opened ? '' : NOTICES_MISSING))
            }}
          >
            Third-party notices
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
