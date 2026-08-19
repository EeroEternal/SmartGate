import React from 'react'
import { Globe } from 'lucide-react'
import { LANGUAGES, Language, useI18n } from '../lib/i18n'
import Select from './Select'

export function LanguageSwitcher({ size = 'sm', className = '' }: { size?: 'sm' | 'md'; className?: string }) {
  const { language, setLanguage } = useI18n()

  const options = LANGUAGES.map((lang) => ({
    id: lang.id,
    name: `${lang.flag} ${lang.name}`,
  }))

  const selected = options.find((opt) => opt.id === language) || options[0]

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <Globe className={`text-zinc-400 shrink-0 ${size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'}`} />
      <div className={size === 'sm' ? 'w-32 min-w-[125px]' : 'w-36 min-w-[140px]'}>
        <Select
          size={size}
          options={options}
          selected={selected}
          onChange={(opt) => setLanguage(opt.id as Language)}
        />
      </div>
    </div>
  )
}
