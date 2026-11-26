import { useId } from 'react'

export function SqliteArtwork({ className = '', size = 40 }: { className?: string; size?: number }) {
  const gradientId = `sqlite-cover-${useId().replace(/:/g, '')}`
  return <svg className={className} width={size} height={size} style={{ width: size, height: size }} viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={gradientId} x1="4" y1="5" x2="44" y2="43" gradientUnits="userSpaceOnUse">
        <stop stopColor="#3785FF" />
        <stop offset="1" stopColor="#1459CC" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="46" height="46" rx="14" fill={`url(#${gradientId})`} stroke="#D5DDFF" strokeOpacity=".55" strokeWidth="1" />
    <path d="M12.5 15.5c0 2.8 5.15 5 11.5 5s11.5-2.2 11.5-5-5.15-5-11.5-5-11.5 2.2-11.5 5Z" fill="white" />
    <path d="M12.5 15.5v17c0 2.8 5.15 5 11.5 5s11.5-2.2 11.5-5v-17" fill="white" />
    <path d="M12.5 23c0 2.8 5.15 5 11.5 5s11.5-2.2 11.5-5M12.5 30.5c0 2.8 5.15 5 11.5 5s11.5-2.2 11.5-5" stroke={`url(#${gradientId})`} strokeWidth="2.3" />
  </svg>
}
