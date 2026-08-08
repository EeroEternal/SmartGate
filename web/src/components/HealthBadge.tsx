interface HealthBadgeProps {
  status?: string | null
  className?: string
}

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  healthy: { dot: 'bg-emerald-500', label: 'Healthy' },
  active: { dot: 'bg-emerald-500', label: 'Active' },
  degraded: { dot: 'bg-amber-500', label: 'Degraded' },
  unavailable: { dot: 'bg-rose-500', label: 'Unavailable' },
  disabled: { dot: 'bg-zinc-300', label: 'Disabled' },
}

export default function HealthBadge({ status, className = '' }: HealthBadgeProps) {
  const key = (status || 'healthy').toLowerCase()
  const style = STATUS_STYLES[key] || { dot: 'bg-zinc-300', label: status || 'Unknown' }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
      <span className="capitalize text-sm text-zinc-700">{style.label}</span>
    </div>
  )
}
