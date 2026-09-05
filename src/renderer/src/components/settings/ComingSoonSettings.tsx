import React from 'react'
import './ComingSoonSettings.css'

interface ComingSoonSettingsProps {
  tabName?: string
}

export const ComingSoonSettings: React.FC<ComingSoonSettingsProps> = ({ tabName }) => {
  return (
    <div className="coming-soon-container">
      <div className="coming-soon-header">
        <h1 className="coming-soon-title">{tabName || 'Будет позже'}</h1>
        <p className="coming-soon-subtitle">Раздел находится в разработке</p>
      </div>

      <div className="coming-soon-body">
        <p className="coming-soon-text">
          Этот раздел появится в будущих обновлениях.
        </p>
      </div>
    </div>
  )
}

export default ComingSoonSettings
