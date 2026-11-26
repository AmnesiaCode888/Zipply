import React from 'react'
import { getIcon } from 'material-file-icons'

interface VSCodeFileIconProps {
  filename?: string
  size?: number
  className?: string
}

/**
 * Authentic VS Code file type icons directly from Material Icon Theme (the official VS Code icon theme pack)
 * Contains all 377+ file extensions (.tsx, .cs, .ts, .js, .css, .html, .json, .md, .py, etc.)
 */
export const VSCodeFileIcon: React.FC<VSCodeFileIconProps> = ({
  filename = 'file',
  size = 15,
  className = ''
}) => {
  const icon = React.useMemo(() => {
    try {
      return getIcon(filename || 'file')
    } catch {
      return null
    }
  }, [filename])

  if (!icon || !icon.svg) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`shrink-0 text-secondary ${className}`}
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
    )
  }

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 [&>svg]:w-full [&>svg]:h-full ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
      aria-label={icon.name}
    />
  )
}
