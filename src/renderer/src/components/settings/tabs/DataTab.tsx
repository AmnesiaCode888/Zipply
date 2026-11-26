import React, { useState } from 'react'
import { Database, Download, Upload, Trash2 } from '../../../icons'
import { SettingsHeader } from './SettingsUI'

interface DataTabProps { storageSize: string; chatCount: number; onExport: () => void; onImportClick: () => void; onClearAll: () => void }
export const DataTab: React.FC<DataTabProps> = ({ storageSize, chatCount, onExport, onImportClick, onClearAll }) => {
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)
  const handleConfirmClear = () => { onClearAll(); setIsConfirmingClear(false) }
  return <div className="space-y-6">
    <SettingsHeader icon={Database} title="Данные" description="Управляйте сохранёнными диалогами на этом компьютере." />
      {/* Storage Footprint */}
      <div className="p-5 bg-surface rounded-[20px] flex flex-wrap gap-4 items-center justify-between border-none shadow-none">
        <div>
          <div className="text-[15px] font-medium text-primary">Хранилище приложения</div>
          <div className="text-[13px] text-secondary mt-0.5">
            Объём данных в браузерном хранилище; резервные копии на диске не учитываются
          </div>
        </div>
        <span className="text-[16px] font-semibold text-primary px-3 py-1 bg-surface-elevated rounded-full">
          {storageSize}
        </span>
      </div>

      {/* Export & Import Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onExport}
          className="p-4 rounded-[18px] bg-surface hover:bg-surface-elevated active:scale-[0.985] transition-all flex items-center justify-center gap-2.5 text-[14px] font-medium text-primary cursor-pointer focus:outline-none border-none shadow-none"
        >
          <Download size={16} />
          <span>Экспорт с вложениями (.zip)</span>
        </button>

        <button
          type="button"
          onClick={onImportClick}
          className="p-4 rounded-[18px] bg-surface hover:bg-surface-elevated active:scale-[0.985] transition-all flex items-center justify-center gap-2.5 text-[14px] font-medium text-primary cursor-pointer focus:outline-none border-none shadow-none"
        >
          <Upload size={16} />
          <span>Импорт диалогов (.zip, .json)</span>
        </button>
      </div>

      <p className="text-[14px] leading-[21px] text-secondary">Импорт заменит текущую историю. При восстановлении архива для чатов будут созданы новые рабочие папки.</p>

      {/* Danger Zone: Clear History */}
      <div className="p-5 bg-surface rounded-[20px] flex flex-wrap gap-4 items-center justify-between border-none shadow-none">
        <div>
          <div className="text-[15px] font-semibold text-primary">
            Очистить всю историю
          </div>
          <div className="text-[13px] text-secondary mt-0.5">
            Удаляет все чаты и сообщения из истории. Чатов сейчас: {chatCount}. Файлы в рабочих папках не удаляются.
          </div>
        </div>

        {isConfirmingClear ? (
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsConfirmingClear(false)}
              className="px-4 py-2 rounded-full bg-control hover:bg-control-hover text-[13px] text-primary transition-all cursor-pointer focus:outline-none border-none shadow-none"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleConfirmClear}
              className="px-4 py-2 rounded-full bg-accent hover:bg-accent-hover text-[13px] text-on-accent font-medium transition-all cursor-pointer focus:outline-none border-none shadow-none"
            >
              Да, удалить
            </button>
          </div>
        ) : (
          <button
            type="button"
            title="Удалить все чаты"
            onClick={() => setIsConfirmingClear(true)}
            className="px-4 py-2 rounded-full bg-surface-elevated hover:bg-control-hover text-[13px] text-primary font-medium flex items-center gap-2 transition-all cursor-pointer focus:outline-none active:scale-95 border-none shadow-none"
          >
            <Trash2 size={15} />
            <span>Удалить все чаты</span>
          </button>
        )}
      </div>
  </div>
}
