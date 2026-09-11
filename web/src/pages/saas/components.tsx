import { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function Coverage({ label, value, detail }: { label: string; value: number; detail: string }) { return <div><div className="flex justify-between text-sm"><span>{label}</span><span className="font-mono">{Math.round(value * 100)}%</span></div><div className="mt-2 h-2 rounded-full bg-zinc-100"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(value * 100, value > 0 ? 2 : 0)}%` }} /></div><div className="mt-1 text-xs text-zinc-500">{detail}</div></div> }

export function errorText(error: unknown) { return error instanceof globalThis.Error ? error.message : 'Something went wrong' }
export function Page({ action, children }: { title?: string; subtitle?: string; action?: ReactNode; children: ReactNode }) { return <div>{action && <div className="flex justify-end">{action}</div>}<div className={action ? 'mt-6' : ''}>{children}</div></div> }
export function Field({ label, value, onChange, placeholder, type = 'text', required = true, alignWithSelect = false, size = 'md' }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; required?: boolean; alignWithSelect?: boolean; size?: 'sm' | 'md' }) {
  if (size === 'sm') {
    return (
      <label className="block text-xs font-medium text-zinc-600">
        {label}
        <input
          required={required}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 outline-none focus:border-zinc-950"
        />
      </label>
    )
  }
  return <label className="block text-sm font-medium text-zinc-700">{label}<input required={required} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${alignWithSelect ? 'mt-1 rounded-md py-2' : 'mt-2 rounded-lg py-2.5'} w-full border border-zinc-300 px-3 outline-none focus:border-zinc-950`} /></label>
}
export function Metric({ label, value, fullValue }: { label: string; value: string; fullValue?: string }) {
  return (
    <div className="min-w-0">
      <div className="h-8 text-xs leading-4 text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-lg sm:text-xl font-semibold leading-7 tabular-nums tracking-tight" title={fullValue || value}>{value}</div>
    </div>
  )
}
export function Stat({ label, value, fullValue }: { label: string; value: string; fullValue?: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-4">
      <Metric label={label} value={value} fullValue={fullValue} />
    </div>
  )
}
export function ErrorMessage({ text }: { text: string }) { return <div className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{text}</div> }
export function Empty({ text, href }: { text: string; href: string }) { return <Link to={href} className="block rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-500 hover:border-zinc-500">{text} <span aria-hidden="true">→</span></Link> }

export function formatMaskedKey(prefix: string) {
  if (!prefix) return '••••••••'
  if (prefix.includes('...') || prefix.includes('••••')) {
    const parts = prefix.split(/\.\.\.|\•+/).filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0]}••••••••${parts[1]}`
    }
  }
  return `${prefix}••••••••`
}
