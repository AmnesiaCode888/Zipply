import React from 'react'
import { ShieldCheck } from '../../../icons'
import type { AccessMode } from '../../../services/settingsService'
import { SettingsHeader } from './SettingsUI'

interface SecurityTabProps { accessMode: AccessMode; onAccessModeChange: (mode: AccessMode) => void }
export const SecurityTab: React.FC<SecurityTabProps> = ({ accessMode, onAccessModeChange }) => (
  <div className="space-y-6">
    <SettingsHeader icon={ShieldCheck} title="Доступ агента" description="Выберите, когда агент спрашивает разрешение на действия." />
      <div className="p-5 bg-surface rounded-[20px] flex flex-col gap-3 border-none shadow-none">
        <div>
          <h2 className="text-[16px] font-semibold text-primary">Доступ агента</h2>
          <p className="mt-1 text-[14px] leading-[22px] text-secondary">Настройка применяется к новым запросам. Терминал не изолирован и может обращаться за пределы папки проекта.</p>
        </div>
        {([
          ['read-only', 'Только чтение', 'Агент изучает файлы и ищет информацию, но не изменяет файлы и не запускает команды.'],
          ['confirm', 'С подтверждением', 'Перед каждой командой и изменением файла потребуется ваше разрешение.'],
          ['automatic', 'Автоматически', 'Агент изменяет файлы и запускает команды самостоятельно; распознанные опасные команды требуют подтверждения.'],
          ['unrestricted', 'Полный доступ', 'Команды и изменения выполняются без подтверждения; внешние пути по-прежнему требуют разрешения.']
        ] as const).map(([value, label, description]) => (
          <label key={value} className={`flex items-center justify-between gap-5 p-4 rounded-[18px] cursor-pointer ${accessMode === value ? 'bg-surface-elevated' : ''}`}>
            <span><span className="block text-[15px] font-medium text-primary">{label}</span><span className="block mt-1 text-[14px] leading-[21px] text-secondary">{description}</span></span>
            <input type="radio" name="access-mode" value={value} checked={accessMode === value} onChange={() => onAccessModeChange(value)} className="shrink-0 accent-white" />
          </label>
        ))}
      </div>

  </div>
)
