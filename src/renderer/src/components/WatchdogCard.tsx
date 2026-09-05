import React from 'react'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { WatchdogSegment } from '../types/chat'
import './WatchdogCard.css'

interface WatchdogCardProps {
  segment: WatchdogSegment
}

export const WatchdogCard: React.FC<WatchdogCardProps> = ({ segment }) => {
  const isIntervene = segment.status === 'intervene'
  const isResolved = segment.resolved === true

  return (
    <div
      className={`watchdog-card watchdog-${segment.status} ${isResolved ? 'watchdog-resolved' : ''}`}
      role="alert"
      title="Watchdog — автоматический анализ прогресса каждые 10 действий"
    >
      <div className="watchdog-icon-wrap">
        {isIntervene ? (
          <ShieldAlert size={13} strokeWidth={2.2} />
        ) : (
          <AlertTriangle size={13} strokeWidth={2.2} />
        )}
      </div>
      <div className="watchdog-body">
        <span className="watchdog-label">Watchdog</span>
        <span className="watchdog-message">{segment.message}</span>
      </div>
      <span className="watchdog-count">#{segment.toolCount}</span>
    </div>
  )
}

export default WatchdogCard
