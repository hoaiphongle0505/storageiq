import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// `npm run test:perf`: the 1M-file tree-store limits (spec §5), alone, with gc() exposed so
// garbage is not counted as tree memory. Writes metrics/perf.json for the CI metrics report.
export default defineConfig({
  resolve: {
    alias: { '@shared': resolve('src/shared') },
  },
  test: {
    include: ['src/**/*.perf.test.ts'],
    environment: 'node',
    execArgv: ['--expose-gc'],
    fileParallelism: false,
  },
})
