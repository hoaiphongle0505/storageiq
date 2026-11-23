import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { build, type Plugin } from 'vite'

const sharedAlias = { '@shared': resolve('src/shared') }

/**
 * Builds the walker worker thread (out/main/walker.js) as its own self-contained bundle. The main
 * build splits shared code into chunks; the packaged app unpacks the worker script from the asar
 * (a worker thread loads real files), and a chunk needed by index.js or scanner.js must not be
 * unpacked, because unpacked files are not covered by the asar integrity check. A separate build
 * has no shared chunks, so only walker.js (and koffi) leave the asar.
 */
function walkerBundle(): Plugin {
  return {
    name: 'storageiq-walker-bundle',
    apply: 'build',
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: 'warn',
        resolve: { alias: sharedAlias },
        build: {
          ssr: resolve('src/worker/scanner/walker-worker.ts'),
          outDir: resolve('out/main'),
          emptyOutDir: false,
          minify: false,
          sourcemap: false,
          rolldownOptions: { output: { format: 'cjs', entryFileNames: 'walker.js' } },
        },
      })
    },
  }
}

export default defineConfig({
  main: {
    plugins: [walkerBundle()],
    resolve: { alias: sharedAlias },
    build: {
      rolldownOptions: {
        // One main build, two entries: the app (out/main/index.js) and the scanner utilityProcess
        // (out/main/scanner.js, forked by src/main/scan/scan-service.ts). The walker worker
        // thread (out/main/walker.js, started by the scanner's walker pool) is built on its own
        // by `walkerBundle`, so it shares no chunk with the other two.
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
