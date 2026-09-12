import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Test runner config. Kept separate from `vite.config.ts` so the dev server proxy and
 * the production build stay untouched.
 *
 * Tests live in `src/tests/**` and are deterministic: no network and no timers.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
