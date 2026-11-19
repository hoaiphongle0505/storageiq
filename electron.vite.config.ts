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
        // One main build, two entries: the app (out/main/index.js) and the scanner
        // utilityProcess (out/main/scanner.js, forked by src/main/scan/scan-service.ts).
        input: {
          index: resolve('src/main/index.ts'),
          scanner: resolve('src/worker/scanner/entry.ts'),
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
