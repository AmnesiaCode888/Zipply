import { useId } from 'react'

export function CyberSecArtwork({ className = '', size = 40 }: { className?: string; size?: number }) {
  const gradientId = `cybersec-cover-${useId().replace(/:/g, '')}`
  return <svg className={className} width={size} height={size} style={{ width: size, height: size }} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gradientId} x1="4" y1="5" x2="44" y2="43" gradientUnits="userSpaceOnUse">
        <stop stopColor="#3785FF" />
        <stop offset="1" stopColor="#1459CC" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="46" height="46" rx="14" fill={`url(#${gradientId})`} stroke="#D5DDFF" strokeOpacity=".55" strokeWidth="1" />
    <path d="m24 7.5 12 4.5v8.5c0 8-4.8 15-12 19.2-7.2-4.2-12-11.2-12-19.2V12l12-4.5Z" fill="white" />
  </svg>
}
