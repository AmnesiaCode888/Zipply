import React, { useState, useEffect, useCallback } from 'react'
import {
  FolderOpen,
  Copy,
  Check,
  Download,
  Upload,
  RefreshCw,
  RotateCcw
} from 'lucide-react'
import { useAiSettingsContext } from '../../hooks/AiSettingsContext'
import './StorageSettings.css'

interface SystemInfo {
  platform: string
  homeDir: string
  userDataDir: string
  storageDir: string
  defaultProjectsDir: string
}

function getPlatformBadge(platform: string): string {
  switch (platform) {
    case 'win32':
      return 'Windows'
    case 'linux':
      return 'Linux'
    case 'darwin':
      return 'macOS'
    default:
      return platform || 'OS'
  }
}

export const StorageSettings: React.FC = () => {
  const { config, updateField, selectDirectory } = useAiSettingsContext()

  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [copied, setCopied] = useState<boolean>(false)
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  const refreshData = useCallback(async () => {
    try {
      if (window.api?.storage?.getInfo) {
        const sysInfo = await window.api.storage.getInfo()
        setInfo(sysInfo)
      }
    } catch (e) {
      console.warn('[StorageSettings] Failed to refresh info:', e)
    }
  }, [])

  useEffect(() => {
    refreshData()
  }, [refreshData])

  const showToast = (text: string, error = false) => {
    setToast({ text, error })
    setTimeout(() => {
      setToast(null)
    }, 3000)
  }

  const handleCopyPath = () => {
    if (!info?.storageDir) return
    navigator.clipboard.writeText(info.storageDir).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      showToast('Путь скопирован')
    })
  }

  const handleOpenFolder = async () => {
    if (!window.api?.storage?.openFolder) return
    try {
      const res = await window.api.storage.openFolder()
      if (!res.success) {
        showToast(res.error || 'Не удалось открыть папку', true)
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка открытия папки', true)
    }
  }

  const handleResetProjectsDir = () => {
    if (info?.defaultProjectsDir) {
      updateField('baseDir', info.defaultProjectsDir)
      showToast('Сброшено на значение по умолчанию')
    }
  }

  const handleExportBackup = async () => {
    if (!window.api?.storage?.exportBackup) return
    setIsExporting(true)
    try {
      const res = await window.api.storage.exportBackup()
      if (res.success && res.filePath) {
        showToast('Резервная копия сохранена')
      } else if (res.error) {
        showToast(`Ошибка экспорта: ${res.error}`, true)
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка экспорта', true)
    } finally {
      setIsExporting(false)
    }
  }

  const handleImportBackup = async () => {
    if (!window.api?.storage?.importBackup) return
    setIsImporting(true)
    try {
      const res = await window.api.storage.importBackup()
      if (res.success) {
        showToast('Данные восстановлены')
        refreshData()
        setTimeout(() => {
          window.location.reload()
        }, 1000)
      } else if (res.error) {
        showToast(res.error, true)
      }
    } catch (err: any) {
      showToast(err?.message || 'Ошибка импорта', true)
    } finally {
      setIsImporting(false)
    }
  }

  const platformBadge = getPlatformBadge(info?.platform || 'win32')
  const currentBaseDir = config.baseDir || info?.defaultProjectsDir || '~/ZipplyProjects'

  return (
    <div className="storage-settings-root">
      {/* Header */}
      <div className="storage-header-bar">
        <div className="storage-header-titles">
          <div className="storage-title-row">
            <h2 className="storage-page-title">Локальное хранилище</h2>
            <span className="storage-platform-chip">{platformBadge}</span>
            {toast && (
              <span className={`storage-toast-chip ${toast.error ? 'error' : ''}`}>
                {toast.text}
              </span>
            )}
          </div>
          <span className="storage-page-subtitle">
            Файловые пути, папка проектов и резервное копирование
          </span>
        </div>

        <button
          type="button"
          className="storage-icon-action-btn"
          onClick={refreshData}
          title="Обновить"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Surface: All options in one unified surface */}
      <div className="storage-options-surface">
        {/* Workspace Directory */}
        <div className="storage-option-row">
          <div className="storage-option-info">
            <span className="storage-option-headline">Папка проектов</span>
            <span className="storage-option-subline">Основная рабочая директория</span>
          </div>

          <div className="storage-row-controls">
            <span className="storage-path-pill" title={currentBaseDir}>
              {currentBaseDir}
            </span>
            <button
              type="button"
              className="storage-ctrl-btn"
              onClick={selectDirectory}
              title="Выбрать другую папку"
            >
              <FolderOpen size={13} />
              <span>Обзор</span>
            </button>
            {info?.defaultProjectsDir && currentBaseDir !== info.defaultProjectsDir && (
              <button
                type="button"
                className="storage-ctrl-btn icon-only"
                onClick={handleResetProjectsDir}
                title="Сбросить на значение по умолчанию"
              >
                <RotateCcw size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Application Data Directory */}
        <div className="storage-option-row">
          <div className="storage-option-info">
            <span className="storage-option-headline">Данные приложения</span>
            <span className="storage-option-subline">Конфигурация, диалоги и база знаний</span>
          </div>

          <div className="storage-row-controls">
            <span className="storage-path-pill" title={info?.storageDir || ''}>
              {info?.storageDir || '...'}
            </span>
            <button
              type="button"
              className="storage-ctrl-btn"
              onClick={handleOpenFolder}
              title="Открыть папку в файловом менеджере"
            >
              <FolderOpen size={13} />
              <span>Открыть</span>
            </button>
            <button
              type="button"
              className="storage-ctrl-btn icon-only"
              onClick={handleCopyPath}
              title="Скопировать путь"
            >
              {copied ? <Check size={13} className="text-green" /> : <Copy size={13} />}
            </button>
          </div>
        </div>

        {/* Backup & Restore */}
        <div className="storage-option-row">
          <div className="storage-option-info">
            <span className="storage-option-headline">Резервная копия</span>
            <span className="storage-option-subline">Экспорт и восстановление всей базы</span>
          </div>

          <div className="storage-row-controls">
            <button
              type="button"
              className="storage-ctrl-btn"
              onClick={handleExportBackup}
              disabled={isExporting}
              title="Создать резервную копию"
            >
              <Download size={13} />
              <span>{isExporting ? 'Экспорт...' : 'Экспорт'}</span>
            </button>
            <button
              type="button"
              className="storage-ctrl-btn"
              onClick={handleImportBackup}
              disabled={isImporting}
              title="Восстановить из файла"
            >
              <Upload size={13} />
              <span>{isImporting ? 'Импорт...' : 'Импорт'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StorageSettings
