import React from 'react'

interface ResizerHandleProps {
  sidebarWidth: number | string
  isResizing: boolean
  onMouseDown: () => void
  onDoubleClick: () => void
}

export const ResizerHandle: React.FC<ResizerHandleProps> = ({
  sidebarWidth,
  isResizing,
  onMouseDown,
  onDoubleClick
}) => {
  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title="Двойной клик — сброс ширины"
      className="group absolute top-0 bottom-0 z-30 w-3 -ml-1.5 cursor-col-resize flex items-center justify-center select-none"
      style={{ left: typeof sidebarWidth === 'number' ? `${sidebarWidth}px` : sidebarWidth }}
    >
      <div
        className={`w-[1.5px] h-full transition-colors duration-150 ${
          isResizing ? 'bg-accent' : 'bg-transparent group-hover:bg-hover-strong'
        }`}
      />
    </div>
  )
}
