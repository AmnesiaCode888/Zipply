import React from 'react'

interface SidebarContainerProps {
  isSidebarOpen: boolean
  sidebarWidth: number
  isResizing: boolean
  compactSettings?: boolean
  children: React.ReactNode
}

export const SidebarContainer: React.FC<SidebarContainerProps> = ({
  isSidebarOpen,
  sidebarWidth,
  isResizing,
  compactSettings = false,
  children
}) => {
  return (
    <div
      style={{
        width: isSidebarOpen ? (compactSettings ? `min(${sidebarWidth}px, 40vw)` : `min(${sidebarWidth}px, max(44px, calc(100vw - 416px)))`) : '0px'
      }}
      className={`h-full flex shrink-0 overflow-hidden ${
        isResizing ? '' : 'transition-all duration-250 ease-out'
      } ${isSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <div style={{ width: compactSettings ? `min(${sidebarWidth}px, 40vw)` : `min(${sidebarWidth}px, max(44px, calc(100vw - 416px)))` }} className="h-full shrink-0">
        {children}
      </div>
    </div>
  )
}
