import { useEffect } from 'react'
import { CrashScreen } from './components/CrashScreen'
import { PickLocationScreen } from './components/PickLocationScreen'
import { ResultScreen } from './components/ResultScreen'
import { ScanningScreen } from './components/ScanningScreen'
import { StatusBar } from './components/StatusBar'
import { useAppStore } from './stores/app-store-context'
import { useScanStore } from './stores/scan-store-context'

export function App() {
  const loadAppInfo = useAppStore((s) => s.loadAppInfo)
  const phase = useScanStore((s) => s.phase)

  useEffect(() => {
    void loadAppInfo()
  }, [loadAppInfo])

  return (
    <div className="grid h-full grid-rows-[1fr_auto] bg-app text-ink">
      <main className="min-h-0 overflow-auto">
        {phase === 'idle' && <PickLocationScreen />}
        {phase === 'scanning' && <ScanningScreen />}
        {(phase === 'done' || phase === 'canceled') && <ResultScreen />}
        {phase === 'failed' && <CrashScreen />}
      </main>
      <StatusBar />
    </div>
  )
}
