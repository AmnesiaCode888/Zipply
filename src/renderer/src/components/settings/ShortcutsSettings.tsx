import React from 'react'
import './ShortcutsSettings.css'

interface ShortcutItem {
  id: string
  action: string
  keys: string[]
  category: string
}

export const ShortcutsSettings: React.FC = () => {
  const shortcuts: ShortcutItem[] = [
    { id: '1', action: 'Новый чат / задача', keys: ['Ctrl', 'N'], category: 'Навигация' },
    { id: '2', action: 'Открыть / скрыть боковую панель', keys: ['Ctrl', 'B'], category: 'Интерфейс' },
    { id: '3', action: 'Открыть / закрыть настройки', keys: ['Ctrl', ','], category: 'Интерфейс' },
    { id: '4', action: 'Поиск по диалогам / заметкам / навыкам', keys: ['Ctrl', 'F'], category: 'Поиск' },
    { id: '5', action: 'Копировать последний блок кода', keys: ['Ctrl', 'Shift', 'C'], category: 'Редактор' },
    { id: '6', action: 'Переключение вкладок (Диалоги / Заметки / Навыки)', keys: ['Ctrl', '1-3'], category: 'Навигация' },
    { id: '7', action: 'Отправить сообщение', keys: ['Enter'], category: 'Ввод' },
    { id: '8', action: 'Перенос строки без отправки', keys: ['Shift', 'Enter'], category: 'Ввод' },
    { id: '9', action: 'Очистить поле ввода / Закрыть настройки', keys: ['Escape'], category: 'Ввод' }
  ]

  return (
    <div className="shortcuts-settings-container">
      {/* Header */}
      <div className="shortcuts-page-header">
        <div>
          <h1 className="shortcuts-page-title">Горячие клавиши</h1>
          <p className="shortcuts-page-subtitle">
            Сочетания клавиш для быстрой навигации и управления рабочим процессом
          </p>
        </div>
      </div>

      {/* Shortcuts List Table */}
      <div className="shortcuts-content-section">
        <div className="shortcuts-clean-table">
          <div className="shortcuts-clean-head">
            <div>Действие</div>
            <div>Категория</div>
            <div style={{ textAlign: 'right' }}>Комбинация</div>
          </div>

          {shortcuts.map((sc) => (
            <div key={sc.id} className="shortcuts-clean-row">
              <div className="shortcut-action-name">{sc.action}</div>
              <div className="shortcut-cat-label">{sc.category}</div>
              <div className="shortcut-keys-caps">
                {sc.keys.map((k, idx) => (
                  <React.Fragment key={k}>
                    <kbd className="key-pill-cap">{k}</kbd>
                    {idx < sc.keys.length - 1 && <span className="key-plus-sign">+</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ShortcutsSettings
