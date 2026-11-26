import { useId } from 'react'

export function PdfArtwork({ className = '', size = 40 }: { className?: string; size?: number }) {
  const gradientId = `pdf-cover-${useId().replace(/:/g, '')}`
  return <svg className={className} width={size} height={size} style={{ width: size, height: size }} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gradientId} x1="4" y1="5" x2="44" y2="43" gradientUnits="userSpaceOnUse">
        <stop stopColor="#3785FF" />
        <stop offset="1" stopColor="#1459CC" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="46" height="46" rx="14" fill={`url(#${gradientId})`} stroke="#D5DDFF" strokeOpacity=".55" strokeWidth="1" />
    <path d="M16 10h10.5L34 17.5v20a2.5 2.5 0 0 1-2.5 2.5h-15a2.5 2.5 0 0 1-2.5-2.5v-25a2.5 2.5 0 0 1 2.5-2.5Z" fill="white" />
    <path d="M26.5 10v6a1.5 1.5 0 0 0 1.5 1.5h6M18 23h12M18 28h12M18 33h8" stroke={`url(#${gradientId})`} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}
