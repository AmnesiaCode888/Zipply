import { useState } from 'react'
import { CalendarClock, Trash2 } from '../../../icons'
import { Field, SettingsHeader, fieldClass } from './SettingsUI'
import { nextOccurrence, type Frequency, type Schedule } from '../../../services/schedules'

const button = 'rounded-full px-4 py-2 bg-surface-elevated text-primary text-[14px] font-medium border-none shadow-none cursor-pointer hover:bg-control-hover'
export function SchedulesTab({ schedules, onChange }: { schedules: Schedule[]; onChange: (schedules: Schedule[]) => boolean }) {
  const [prompt, setPrompt] = useState('')
  const [folder, setFolder] = useState('')
  const [date, setDate] = useState('')
  const [frequency, setFrequency] = useState<Frequency>('once')
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(schedules.length === 0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const resetForm = () => { setPrompt(''); setFolder(''); setDate(''); setFrequency('once'); setEditingId(null); setError(''); setShowForm(false) }
  const edit = (task: Schedule) => {
    const local = new Date(task.nextRun - new Date(task.nextRun).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    setPrompt(task.prompt); setFolder(task.folderPath); setDate(local); setFrequency(task.frequency); setEditingId(task.id); setError(''); setShowForm(true)
  }
  const save = (next: Schedule[]): boolean => {
    if (onChange(next)) { setError(''); return true }
    setError('Не удалось сохранить расписание. Проверьте хранилище приложения.'); return false
  }
  const add = () => {
    const nextRun = new Date(date).getTime()
    if (!prompt.trim() || !folder || !Number.isFinite(nextRun) || nextRun <= Date.now()) { setError('Укажите задачу, папку и будущие дату и время.'); return }
    const task: Schedule = { id: editingId || crypto.randomUUID(), prompt: prompt.trim(), folderPath: folder, frequency, nextRun, enabled: editingId ? schedules.find(item => item.id === editingId)?.enabled ?? true : true }
    if (save(editingId ? schedules.map(item => item.id === editingId ? task : item) : [...schedules, task])) resetForm()
  }
  return <div className="space-y-6">
    <SettingsHeader icon={CalendarClock} title="Расписание" description="Задачи запускаются, пока Zipply открыт. Пропущенные запуски не выполняются после открытия." />
    {error && <p role="alert" className="rounded-[20px] bg-surface px-4 py-3 text-[15px] text-secondary">{error}</p>}
    {schedules.length === 0 && <p className="rounded-[20px] bg-surface px-5 py-4 text-[15px] text-secondary">Запланированных задач пока нет.</p>}
    {!showForm && <div><button type="button" className={button} onClick={() => setShowForm(true)}>Новая задача</button></div>}
    {showForm && <Field id="schedule-prompt" label={editingId ? 'Изменить задачу' : 'Новая задача'} description="Опишите, что должен сделать агент.">
      <textarea id="schedule-prompt" rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} className={`${fieldClass} resize-y`} placeholder="Например: запусти тесты и расскажи о результатах" />
      <button type="button" className={button} onClick={async () => { const selected = await window.api.workspace.selectFolder(); if (selected) setFolder(selected) }}>{folder || 'Выбрать папку проекта'}</button>
      <label htmlFor="schedule-date" className="text-[14px] text-secondary">Дата и время первого запуска</label>
      <input id="schedule-date" type="datetime-local" style={{ colorScheme: 'dark' }} className={fieldClass} value={date} onChange={e => setDate(e.target.value)} />
      <label htmlFor="schedule-frequency" className="text-[14px] text-secondary">Повтор</label>
      <select id="schedule-frequency" className={fieldClass} value={frequency} onChange={e => setFrequency(e.target.value as Frequency)}><option value="once">Один раз</option><option value="daily">Каждый день</option><option value="weekly">Каждую неделю</option></select>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} onClick={add}>{editingId ? 'Сохранить задачу' : 'Добавить задачу'}</button><button type="button" className={button} onClick={resetForm}>Отмена</button></div>
    </Field>}
    <div className="space-y-3">{schedules.map(task => <div key={task.id} className="rounded-[20px] bg-surface p-5 border-none shadow-none">
      <p className="text-[16px] leading-[24px] text-primary break-words">{task.prompt}</p>
      <p className="mt-1 text-[14px] leading-[21px] text-secondary break-all">{task.folderPath}</p>
      <p className="mt-1 text-[14px] text-secondary">{task.enabled ? `Следующий запуск: ${new Date(task.nextRun).toLocaleString('ru-RU')}` : 'Отключена или завершена'} · {task.frequency === 'daily' ? 'ежедневно' : task.frequency === 'weekly' ? 'еженедельно' : 'один раз'}</p>
      <div className="mt-3 flex flex-wrap gap-2">{(task.frequency !== 'once' || task.enabled || task.nextRun > Date.now()) && <button type="button" className={button} onClick={() => save(schedules.map(item => { if (item.id !== task.id) return item; let nextRun = item.nextRun; if (!item.enabled && item.frequency === 'once' && nextRun <= Date.now()) return item; if (!item.enabled) while (nextRun <= Date.now()) nextRun = nextOccurrence(nextRun, item.frequency); return { ...item, nextRun, enabled: !item.enabled } }))}>{task.enabled ? 'Приостановить' : 'Включить'}</button>}<button type="button" className={button} onClick={() => edit(task)}>Изменить</button>{deletingId === task.id ? <><button type="button" className={button} onClick={() => setDeletingId(null)}>Отмена</button><button type="button" className={button} onClick={() => { if (save(schedules.filter(item => item.id !== task.id))) { setDeletingId(null); if (editingId === task.id) resetForm() } }}>Удалить задачу</button></> : <button type="button" aria-label={`Удалить задачу: ${task.prompt}`} className={button} onClick={() => setDeletingId(task.id)}><Trash2 size={16} /></button>}</div>
    </div>)}</div>
  </div>
}

