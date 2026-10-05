import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SaasLayout } from '../pages/saas/SaasLayout'
import { I18nProvider } from '../lib/i18n'

vi.mock('../lib/saasApi', () => ({
  saasFetch: vi.fn(async (path: string) => ({
    success: true,
    data: path.includes('model-services') ? [] : { email: 'mobile@example.com' },
  })),
  saasLogout: vi.fn(),
  saasUpdateProfile: vi.fn(),
}))

// The jsdom environment runs on an opaque origin where `localStorage` is undefined.
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

/**
 * Mobile nav regression check: on small screens the /app nav panel must start
 * collapsed and open from the header hamburger button. jsdom has no Tailwind
 * stylesheet, so the check asserts the `hidden`/`block` state classes.
 */
describe('mobile navigation', () => {
  it('starts collapsed and toggles from the header menu button', () => {
    const { container } = render(
      <I18nProvider>
        <MemoryRouter initialEntries={['/app']}>
          <SaasLayout>
            <div>content</div>
          </SaasLayout>
        </MemoryRouter>
      </I18nProvider>
    )

    const panel = container.querySelector('aside')
    expect(panel).not.toBeNull()
    expect(panel!.className).toContain('hidden')

    const toggle = container.querySelector('button[aria-label="Open menu"]')
    expect(toggle).not.toBeNull()
    fireEvent.click(toggle!)

    expect(panel!.className).not.toContain('hidden')
    expect(screen.getByText('content')).toBeInTheDocument()
  })
})
