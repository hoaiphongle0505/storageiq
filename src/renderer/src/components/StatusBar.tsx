import { useAppStore } from '../stores/app-store-context'
import { useScanStore } from '../stores/scan-store-context'

export function StatusBar() {
  const target = useScanStore((s) => s.target)
  const appInfo = useAppStore((s) => s.appInfo)

  return (
    <footer className="flex h-7 items-center justify-between gap-4 border-t border-line bg-panel px-3 text-xs text-ink-muted">
      <span className="min-w-0 truncate" title={target ?? undefined}>
        {target ?? 'No folder selected'}
      </span>
      {appInfo !== null && (
        <span className="shrink-0 tabular-nums">StorageIQ {appInfo.version}</span>
      )}
    </footer>
  )
}
