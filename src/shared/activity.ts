/** A model-supplied label is presentation metadata, never a command. */
export function normalizeActivity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const label = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return label ? Array.from(label).slice(0, 80).join('') : undefined
}

/** Creates stable UI metadata when a model call does not provide an activity label. */
export function inferToolActivity(toolName: unknown, rawArgs?: unknown): string {
  const name = typeof toolName === 'string' ? toolName.toLowerCase() : ''
  const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
    ? rawArgs as Record<string, unknown>
    : {}
  const supplied = normalizeActivity(args.activity)
  if (supplied) return supplied

  const value = (...keys: string[]): string => {
    for (const key of keys) if (typeof args[key] === 'string' && (args[key] as string).trim()) return (args[key] as string).trim()
    return ''
  }
  const short = (text: string): string => Array.from(text).slice(0, 48).join('') + (Array.from(text).length > 48 ? '…' : '')
  const withTarget = (label: string, target: string): string => normalizeActivity(target ? `${label} ${short(target)}` : label) || label

  if (name === 'search_web') return withTarget('Ищу в интернете', value('query'))
  if (name === 'read_page') return withTarget('Читаю страницу', value('url'))
  if (name === 'read_file') return withTarget('Читаю файл', value('path', 'filePath', 'file_path', 'filepath', 'filename'))
  if (name === 'read_files') {
    const files = Array.isArray(args.files) ? args.files : []
    if (files.length === 1) return withTarget('Читаю файл', typeof files[0]?.path === 'string' ? files[0].path : '')
    if (files.length === 0) return 'Читаю файлы'
    const lastDigit = files.length % 10, lastTwoDigits = files.length % 100
    const noun = lastTwoDigits >= 11 && lastTwoDigits <= 14 ? 'файлов' : lastDigit === 1 ? 'файл' : lastDigit >= 2 && lastDigit <= 4 ? 'файла' : 'файлов'
    return `Читаю ${files.length} ${noun}`
  }
  if (name === 'write_file') return withTarget('Записываю файл', value('path', 'filePath', 'file_path', 'filename'))
  if (name === 'edit_file') return withTarget('Изменяю файл', value('path', 'filePath', 'file_path', 'filename'))
  if (name === 'list_dir') return withTarget('Изучаю папку', value('path') || '.')
  if (name === 'search_project') return withTarget('Ищу в проекте', value('query'))
  if (name === 'find_files') return withTarget('Ищу файлы', value('pattern'))
  if (name === 'code_intelligence') return withTarget('Анализирую код', value('path'))
  if (name === 'cybersec_audit_project') return 'Проверяю безопасность проекта'
  if (name === 'cybersec_check_ports') return withTarget('Проверяю TCP-порты', value('host'))
  if (name === 'cybersec_dns_records') return withTarget('Проверяю DNS-записи', value('host'))
  if (name === 'cybersec_check_tls') return withTarget('Проверяю TLS-сертификат', value('host'))
  if (name === 'cybersec_scan_secrets') return 'Ищу секреты в проекте'
  if (name === 'cybersec_audit_server_config') return 'Проверяю конфиги сервера'
  if (name === 'cybersec_check_http_posture') return withTarget('Проверяю HTTP-защиту', value('url'))
  if (name === 'sqlite_inspect_database') return withTarget('Анализирую SQLite', value('path'))
  if (name === 'pdf_analyze_document') return withTarget('Анализирую PDF', value('path'))
  if (name === 'terminal' || name === 'run_command' || name === 'execute_command' || name === 'bash' || name === 'sh') return 'Выполняю команду'
  if (name === 'process_start') return 'Запускаю процесс'
  if (name === 'process_poll') return 'Проверяю процесс'
  if (name === 'process_stop') return 'Останавливаю процесс'
  if (name === 'process_list') return 'Проверяю процессы'
  if (name === 'apply_patch') return 'Применяю пакет правок'
  if (name === 'update_plan') return 'Обновляю план задачи'
  if (name === 'spawn_agent') return withTarget('Запускаю субагента', value('role'))
  if (name === 'ask_user') return 'Уточняю детали'
  if (name === 'load_skill') return withTarget('Подключаю навык', value('skillId'))
  if (name === 'search_skills') return withTarget('Ищу навык', value('query'))
  if (name === 'install_skill') return args.action === 'install' ? withTarget('Устанавливаю навык', value('slug')) : withTarget('Ищу навык в каталоге', value('query'))
  if (name === 'save_skill') return 'Сохраняю навык'
  if (name === 'search_tools') return withTarget('Ищу инструменты', value('query'))
  return name ? `Выполняю: ${name}` : 'Выполняю действие'
}
