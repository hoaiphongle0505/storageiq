import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import { build, type Plugin } from 'vite'

const sharedAlias = { '@shared': resolve('src/shared') }

/** Worker thread scripts built as their own bundles, next to the main build in out/main. */
const WORKER_BUNDLES = [
  { entry: 'src/worker/scanner/walker-worker.ts', fileName: 'walker.js' },
  { entry: 'src/main/shell-menu/shell-worker.ts', fileName: 'shell-worker.js' },
  { entry: 'src/main/icons/icon-worker.ts', fileName: 'icon-worker.js' },
] as const

/**
 * Builds each worker thread (out/main/walker.js, shell-worker.js and icon-worker.js) as its own
 * self-contained bundle. The main build splits shared code into chunks; the packaged app unpacks
 * the worker scripts from the asar (a worker thread loads real files), and a chunk needed by
 * index.js or scanner.js must not be unpacked, because unpacked files are not covered by the asar
 * integrity check. A separate build per worker has no shared chunks, so only the worker scripts
 * (and koffi) leave the asar.
 */
function workerBundles(): Plugin {
  return {
    name: 'storageiq-worker-bundles',
    apply: 'build',
    async closeBundle() {
      for (const { entry, fileName } of WORKER_BUNDLES) {
        await build({
          configFile: false,
          logLevel: 'warn',
          resolve: { alias: sharedAlias },
          build: {
            ssr: resolve(entry),
            outDir: resolve('out/main'),
            emptyOutDir: false,
            minify: false,
            sourcemap: false,
            rolldownOptions: { output: { format: 'cjs', entryFileNames: fileName } },
          },
        })
      }
    },
  }
}

export default defineConfig({
  main: {
    plugins: [workerBundles()],
    resolve: { alias: sharedAlias },
    build: {
      rolldownOptions: {
        // One main build, two entries: the app (out/main/index.js) and the scanner utilityProcess
        // (out/main/scanner.js, forked by src/main/scan/scan-service.ts). The worker threads
        // (out/main/walker.js, started by the scanner's walker pool, and out/main/shell-worker.js,
        // started by the shell worker pool, and out/main/icon-worker.js, started by the icon service) are built on their own by `workerBundles`, so they
        // share no chunk with the other two.
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
