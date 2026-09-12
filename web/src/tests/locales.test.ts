import { describe, expect, it } from 'vitest'

import en from '../locales/en.json'
import ja from '../locales/ja.json'
import ko from '../locales/ko.json'
import zh from '../locales/zh.json'

/**
 * Guards the AGENTS.md i18n rule: every UI string must exist in all locale files, with
 * `en.json` as the source of truth. A key added to only one language fails here.
 */

type LocaleName = 'en' | 'zh' | 'ja' | 'ko'

/** Flatten nested namespaces ("services.title") into a single key level. */
function flatten(value: unknown, prefix = '', out: Record<string, unknown> = {}): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out)
    }
  } else if (prefix) {
    out[prefix] = value
  }
  return out
}

const bundles: Record<LocaleName, Record<string, unknown>> = {
  en: flatten(en),
  zh: flatten(zh),
  ja: flatten(ja),
  ko: flatten(ko),
}

const localeNames = Object.keys(bundles) as LocaleName[]
const sourceKeys = new Set(Object.keys(bundles.en))

describe('locale files', () => {
  it('loads all four locale bundles with a non-trivial key count', () => {
    expect(localeNames).toHaveLength(4)
    expect(sourceKeys.size).toBeGreaterThan(100)
  })

  for (const name of localeNames) {
    describe(`${name}.json`, () => {
      it('has exactly the same flattened keys as en.json', () => {
        const keys = new Set(Object.keys(bundles[name]))
        const missing = [...sourceKeys].filter((key) => !keys.has(key)).sort()
        const extra = [...keys].filter((key) => !sourceKeys.has(key)).sort()

        expect({ locale: name, missing }).toEqual({ locale: name, missing: [] })
        expect({ locale: name, extra }).toEqual({ locale: name, extra: [] })
        expect(keys.size).toBe(sourceKeys.size)
      })

      it('has only non-empty string values', () => {
        const empty = Object.entries(bundles[name])
          .filter(([, value]) => typeof value === 'string' && value.trim() === '')
          .map(([key]) => key)
          .sort()
        expect({ locale: name, empty }).toEqual({ locale: name, empty: [] })

        const nonString = Object.entries(bundles[name])
          .filter(([, value]) => typeof value !== 'string')
          .map(([key]) => key)
          .sort()
        expect({ locale: name, nonString }).toEqual({ locale: name, nonString: [] })
      })
    })
  }
})
