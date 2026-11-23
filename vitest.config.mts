import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    // Perf tests run alone (`npm run test:perf`), so other test files cannot skew their timings.
    exclude: ['**/node_modules/**', 'src/**/*.perf.test.ts'],
    environment: 'node',
    setupFiles: ['src/renderer/src/test/setup.ts'],
    restoreMocks: true,
  },
})
