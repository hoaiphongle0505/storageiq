import { useEffect } from 'react'
import { StatusBar } from './components/StatusBar'
import { WelcomePanel } from './components/WelcomePanel'
import { useAppStore } from './stores/app-store-context'

export function App() {
  const loadAppInfo = useAppStore((s) => s.loadAppInfo)

  useEffect(() => {
    void loadAppInfo()
  }, [loadAppInfo])

  return (
    <div className="grid h-full grid-rows-[1fr_auto] bg-app text-ink">
      <main className="min-h-0 overflow-auto">
        <WelcomePanel />
      </main>
      <StatusBar />
    </div>
  )
}
