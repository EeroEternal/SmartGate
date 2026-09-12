import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount anything rendered by @testing-library/react between tests. Auto-cleanup is
// only registered when Vitest globals are enabled, which this project keeps off.
afterEach(() => {
  cleanup()
})
