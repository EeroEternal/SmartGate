import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import en from '../locales/en.json'
import zh from '../locales/zh.json'
import ja from '../locales/ja.json'
import ko from '../locales/ko.json'

export type Language = 'en' | 'zh' | 'ja' | 'ko'

export const LANGUAGES: { id: Language; name: string; flag: string }[] = [
  { id: 'en', name: 'English', flag: '🇺🇸' },
  { id: 'zh', name: '简体中文', flag: '🇨🇳' },
  { id: 'ja', name: '日本語', flag: '🇯🇵' },
  { id: 'ko', name: '한국어', flag: '🇰🇷' },
]

const translations: Record<Language, Record<string, any>> = {
  en,
  zh,
  ja,
  ko,
}

interface I18nContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextType>({
  language: 'en',
  setLanguage: () => {},
  t: (key: string) => key,
})

function getNestedTranslation(obj: any, path: string): string | undefined {
  if (!obj) return undefined
  const keys = path.split('.')
  let current = obj
  for (const k of keys) {
    if (current === undefined || current === null) return undefined
    current = current[k]
  }
  return typeof current === 'string' ? current : undefined
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const saved = localStorage.getItem('smartgate_lang') as Language
    if (saved && ['en', 'zh', 'ja', 'ko'].includes(saved)) {
      return saved
    }
    const navLang = navigator.language.toLowerCase()
    if (navLang.startsWith('zh')) return 'zh'
    if (navLang.startsWith('ja')) return 'ja'
    if (navLang.startsWith('ko')) return 'ko'
    return 'en'
  })

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('smartgate_lang', lang)
    document.documentElement.lang = lang
  }

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const t = (key: string, vars?: Record<string, string | number>): string => {
    let text = getNestedTranslation(translations[language], key)
    if (text === undefined) {
      text = getNestedTranslation(translations.en, key)
    }
    if (text === undefined) {
      return key
    }
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text!.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      })
    }
    return text
  }

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  return useContext(I18nContext)
}
