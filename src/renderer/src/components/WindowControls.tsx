import React from 'react'
import { useWindowControls } from '../hooks/useWindowControls'
import './WindowControls.css'

export const WindowControls: React.FC = () => {
  const { isMaximized, minimize, maximize, close } = useWindowControls()

  return (
    <div className="window-controls">
      <button
        type="button"
        className="control-btn btn-green"
        onClick={maximize}
        title={isMaximized ? 'Восстановить' : 'Развернуть'}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
      >
        <svg viewBox="0 0 10 10" fill="currentColor">
          {isMaximized ? (
            <path
              d="M2.5 4.5l2.5-2.5 2.5 2.5M7.5 5.5l-2.5 2.5-2.5-2.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ) : (
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          )}
        </svg>
      </button>
      <button
        type="button"
        className="control-btn btn-yellow"
        onClick={minimize}
        title="Свернуть"
        aria-label="Minimize"
      >
        <svg viewBox="0 0 10 10" fill="currentColor">
          <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="control-btn btn-red"
        onClick={close}
        title="Закрыть"
        aria-label="Close"
      >
        <svg viewBox="0 0 10 10" fill="currentColor">
          <path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

export default WindowControls
