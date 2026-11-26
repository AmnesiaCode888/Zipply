import React from 'react'

interface ShinyTextProps {
  text: string
  isActive?: boolean
  className?: string
}

/**
 * Premium Apple-inspired Metallic Shiny Text.
 * When active: a delicate light sweep glides across the typography.
 * When inactive: the shine effect smoothly dissolves over 700ms with zero abrupt cutoff.
 */
export const ShinyText: React.FC<ShinyTextProps> = ({
  text,
  isActive = false,
  className = ''
}) => {
  return (
    <span className={`relative inline-block antialiased ${className}`}>
      {/* Base text: guarantees identical layout & baseline */}
      <span
        className={`transition-colors duration-700 ${
          isActive ? 'text-primary' : 'text-secondary'
        }`}
      >
        {text}
      </span>

      {/* Shimmering light sweep overlay that gently dissolves via opacity transition */}
      <span
        aria-hidden="true"
        className={`absolute inset-0 pointer-events-none select-none transition-opacity duration-700 ease-out ${
          isActive ? 'opacity-100' : 'opacity-0'
        } shiny-text-shimmer`}
      >
        {text}
      </span>
    </span>
  )
}
