import React, { useState, useMemo } from 'react'
import { Trash2, Terminal, Clock } from 'lucide-react'
import { ActivityItem } from '../../types/activity'
import { ProjectRef } from '../../types/chat'
import { FileIcon } from '../files/FileIcon'
import './ActivityLogView.css'

export interface ActivityLogViewProps {
  items: ActivityItem[]
  onSelectItem: (item: ActivityItem) => void
  onClearLog?: () => void
  activeProject?: ProjectRef | null
}

export const ActivityLogView: React.FC<ActivityLogViewProps> = ({
  items,
  onSelectItem,
  onClearLog,
  activeProject
}) => {
  const [filter, setFilter] = useState<'all' | 'files' | 'terminal'>('all')

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filter === 'files') {
        return item.type === 'file_create' || item.type === 'file_edit' || item.type === 'file_delete'
      }
      if (filter === 'terminal') {
        return item.type === 'terminal_command'
      }
      return true
    })
  }, [items, filter])

  const fileCount = useMemo(
    () =>
      items.filter(
        (i) => i.type === 'file_create' || i.type === 'file_edit' || i.type === 'file_delete'
      ).length,
    [items]
  )

  const termCount = useMemo(
    () => items.filter((i) => i.type === 'terminal_command').length,
    [items]
  )

  const formatShortTime = (ts: number): string => {
    const diffSec = Math.floor((Date.now() - ts) / 1000)
    if (diffSec < 20) return 'сейчас'
    if (diffSec < 60) return `${diffSec}с`
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}м`
    const date = new Date(ts)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const getRelativeFolder = (fullPath?: string): string => {
    if (!fullPath) return ''
    let p = fullPath
    if (activeProject?.path && p.startsWith(activeProject.path)) {
      p = p.slice(activeProject.path.length).replace(/^[/\\]+/, '')
    }
    const idx = p.lastIndexOf('/') !== -1 ? p.lastIndexOf('/') : p.lastIndexOf('\\')
    return idx !== -1 ? p.substring(0, idx) : ''
  }

  return (
    <div className="activity-view-container">
      {/* Minimal Toolbar */}
      <div className="activity-toolbar">
        <div className="activity-filter-group">
          <button
            type="button"
            className={`activity-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            Все {items.length > 0 ? items.length : ''}
          </button>
          <button
            type="button"
            className={`activity-filter-btn ${filter === 'files' ? 'active' : ''}`}
            onClick={() => setFilter('files')}
          >
            Файлы {fileCount > 0 ? fileCount : ''}
          </button>
          <button
            type="button"
            className={`activity-filter-btn ${filter === 'terminal' ? 'active' : ''}`}
            onClick={() => setFilter('terminal')}
          >
            Команды {termCount > 0 ? termCount : ''}
          </button>
        </div>

        {items.length > 0 && onClearLog && (
          <button
            type="button"
            className="activity-clear-btn"
            onClick={onClearLog}
            title="Очистить лог"
            aria-label="Очистить лог"
          >
            <Trash2 size={12} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {/* List / Empty State */}
      <div className="activity-list">
        {filteredItems.length === 0 ? (
          <div className="activity-empty-state">
            <Clock size={28} strokeWidth={1.5} className="activity-empty-icon" />
            <div className="activity-empty-title">Нет записей</div>
            <div className="activity-empty-subtitle">
              Здесь будут отображаться новые и изменённые файлы проекта.
            </div>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isFile =
              item.type === 'file_create' || item.type === 'file_edit' || item.type === 'file_delete'
            const fileName = item.filePath
              ? item.filePath.replace(/.*[/\\]/, '')
              : item.title || item.command || 'команда'
            const folder = getRelativeFolder(item.filePath)

            return (
              <div
                key={item.id}
                className="activity-row"
                onClick={() => {
                  if (isFile) {
                    onSelectItem(item)
                  }
                }}
                title={item.filePath || item.command || item.title}
              >
                <span className="activity-row-icon">
                  {isFile ? (
                    <FileIcon name={fileName} isDirectory={false} size={15} />
                  ) : (
                    <Terminal size={13} color="var(--text-muted)" />
                  )}
                </span>

                <span className="activity-row-name">{fileName}</span>

                {folder && <span className="activity-row-path">{folder}</span>}

                {/* Status Indicator */}
                {item.type === 'file_create' && (
                  <span className="activity-row-badge badge-u" title="Новый файл (Untracked)">
                    U
                  </span>
                )}
                {item.type === 'file_edit' && (
                  <span className="activity-row-badge badge-m" title="Изменён (Modified)">
                    M
                  </span>
                )}
                {item.type === 'file_delete' && (
                  <span className="activity-row-badge badge-d" title="Удалён (Deleted)">
                    D
                  </span>
                )}

                {item.diffStats && (item.diffStats.add > 0 || item.diffStats.del > 0) && (
                  <span className="activity-row-stats">
                    {item.diffStats.add > 0 && (
                      <span className="activity-stat-add">+{item.diffStats.add}</span>
                    )}
                    {item.diffStats.del > 0 && (
                      <span className="activity-stat-del">-{item.diffStats.del}</span>
                    )}
                  </span>
                )}

                <span className="activity-row-time">{formatShortTime(item.timestamp)}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default ActivityLogView
