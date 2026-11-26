"use client"

import React from 'react'

type ShiningTextProps = {
  text?: string
  children?: React.ReactNode
  className?: string
}

export function ShiningText({ text, children, className = '' }: ShiningTextProps): React.JSX.Element {
  return (
    <span
      data-shining-text="true"
      className={`shining-text inline-block min-w-0 ${className}`}
    >
      {children ?? text}
    </span>
  )
}
