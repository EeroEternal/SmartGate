interface BrandMarkProps {
  className?: string
}

export default function BrandMark({ className = 'h-5 w-5' }: BrandMarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M6 8h7l5 4h8M6 16h20M6 24h7l5-4h8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <circle cx="6" cy="8" fill="currentColor" r="2" />
      <circle cx="6" cy="16" fill="currentColor" r="2" />
      <circle cx="6" cy="24" fill="currentColor" r="2" />
      <circle cx="26" cy="12" fill="currentColor" r="2" />
      <circle cx="26" cy="20" fill="currentColor" r="2" />
    </svg>
  )
}
