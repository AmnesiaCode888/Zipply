export function ImportConfirm({ fileName, onCancel, onConfirm }: { fileName: string; onCancel: () => void; onConfirm: () => void }) {
  return <div role="dialog" aria-labelledby="import-title" aria-describedby="import-description" className="rounded-[20px] bg-surface p-5 space-y-4">
    <div><h2 id="import-title" className="text-[19px] font-semibold text-primary">Заменить историю?</h2>
      <p id="import-description" className="mt-2 text-[15px] leading-[23px] text-secondary break-words">Импорт файла «{fileName}» заменит текущую историю. При восстановлении ZIP-архива для чатов будут созданы новые рабочие папки.</p></div>
    <div className="flex flex-wrap gap-2"><button type="button" onClick={onCancel} className="rounded-full bg-surface-elevated px-4 py-2 text-[14px] text-primary border-none shadow-none">Отмена</button><button type="button" onClick={onConfirm} className="rounded-full bg-accent hover:bg-accent-hover px-4 py-2 text-[14px] font-medium text-on-accent border-none shadow-none">Заменить историю</button></div>
  </div>
}
