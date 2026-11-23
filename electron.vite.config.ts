import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const sharedAlias = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: {
      rolldownOptions: {
        // One main build, three entries: the app (out/main/index.js), the scanner
        // utilityProcess (out/main/scanner.js, forked by src/main/scan/scan-service.ts) and the
        // walker worker thread (out/main/walker.js, started by the scanner's walker pool).
        input: {
          index: resolve('src/main/index.ts'),
          scanner: resolve('src/worker/scanner/entry.ts'),
          walker: resolve('src/worker/scanner/walker-worker.ts'),
        },
      },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
  },
  renderer: {
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve('src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
  },
})
