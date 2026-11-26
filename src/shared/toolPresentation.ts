export type ToolPresentationType = 'file_edit' | 'terminal' | 'file_read' | 'search' | 'thinking' | 'folder'

export const CYBERSEC_TOOL_LABELS: Record<string, string> = {
  cybersec_audit_project: 'Аудит проекта',
  cybersec_check_headers: 'HTTP-заголовки',
  cybersec_check_ports: 'TCP-порты',
  cybersec_dns_records: 'DNS-записи',
  cybersec_check_tls: 'TLS-сертификат',
  cybersec_scan_secrets: 'Поиск секретов',
  cybersec_audit_server_config: 'Конфигурация сервера',
  cybersec_check_http_posture: 'HTTP-защита',
  cybersec_check_ssh_host_key: 'SSH-отпечаток',
  cybersec_npm_audit: 'npm-аудит',
  cybersec_probe_services: 'Баннеры сервисов'
}

export const CYBERSEC_CARD_TITLES: Record<string, string> = {
  cybersec_audit_project: 'Аудит проекта',
  cybersec_check_headers: 'Проверка HTTP-заголовков',
  cybersec_check_ports: 'Проверка TCP-портов',
  cybersec_dns_records: 'Проверка DNS',
  cybersec_check_tls: 'Проверка TLS-сертификата',
  cybersec_scan_secrets: 'Поиск секретов',
  cybersec_audit_server_config: 'Аудит конфигурации сервера',
  cybersec_check_http_posture: 'Проверка HTTP-защиты',
  cybersec_check_ssh_host_key: 'Проверка SSH-отпечатка',
  cybersec_npm_audit: 'Аудит npm-зависимостей',
  cybersec_probe_services: 'Проверка баннеров сервисов'
}

const PROCESS_LABELS: Record<string, string> = {
  process_start: 'Запуск процесса',
  process_poll: 'Вывод процесса',
  process_stop: 'Остановка процесса',
  process_list: 'Список процессов'
}

const ANALYSIS_OPERATIONS: Record<string, string> = {
  definition: 'Поиск определения',
  references: 'Поиск использований',
  diagnostics: 'Диагностика'
}

export function cyberSecTarget(name: string, args: Record<string, unknown> | undefined): string {
  if (!args) return ''
  const target = name === 'cybersec_check_headers' || name === 'cybersec_check_http_posture'
    ? args.url
    : name === 'cybersec_scan_secrets' || name === 'cybersec_audit_server_config' || name === 'cybersec_audit_project' || name === 'cybersec_npm_audit'
      ? 'Проект'
      : args.host
  return typeof target === 'string' ? target : ''
}

export function formatAnalysisDetail(args: Record<string, unknown> | undefined): string | undefined {
  const operation = ANALYSIS_OPERATIONS[String(args?.operation)]
  if (!operation) return undefined
  return typeof args?.line === 'number' && typeof args?.column === 'number'
    ? `${operation} · ${args.line}:${args.column}`
    : operation
}

export interface ToolPresentationInput {
  toolName: string
  args?: Record<string, unknown>
  parsedPath?: string
  parsedCommand?: string
  parsedQuery?: string
  parsedFiles?: string
  isStreaming?: boolean
}

export interface ToolPresentation {
  type: ToolPresentationType
  label: string
  targetName: string
  analysisDetail?: string
}

/**
 * Resolves UI presentation metadata (icon category, label, target) uniformly for streaming and started tool calls.
 */
export function resolveToolPresentation(input: ToolPresentationInput): ToolPresentation {
  const { toolName, args, parsedPath, parsedCommand, parsedQuery, parsedFiles, isStreaming = false } = input
  const str = (value: unknown): string => (value === undefined || value === null ? '' : String(value))
  const argPath = str(args?.path || args?.filePath || args?.file_path || args?.filepath || args?.filename || args?.file)

  if (toolName === 'edit_file' || toolName === 'write_file') {
    return {
      type: 'file_edit',
      label: toolName === 'edit_file' ? 'Отредактировал' : 'Написал',
      targetName: parsedPath || argPath
    }
  }
  if (toolName === 'list_dir') {
    return {
      type: 'folder',
      label: 'Папка',
      targetName: parsedPath || str(args?.path) || '.'
    }
  }
  if (
    toolName === 'exec_command' ||
    toolName === 'write_stdin' ||
    toolName === 'run_command' ||
    toolName === 'terminal' ||
    toolName === 'execute_command' ||
    toolName === 'bash' ||
    toolName === 'sh'
  ) {
    return {
      type: 'terminal',
      label: toolName === 'write_stdin' ? 'Ввод в терминал' : 'Терминал',
      targetName: parsedCommand || str(args?.command || args?.cmd || args?.session_id)
    }
  }
  if (toolName === 'search_web' || toolName === 'search_project' || toolName === 'find_files') {
    return {
      type: 'search',
      label: 'Поиск',
      targetName: parsedQuery || str(args?.query || args?.pattern)
    }
  }
  if (toolName === 'read_file' || toolName === 'read_page' || toolName === 'read_files' || toolName === 'code_intelligence') {
    const targetName = toolName === 'read_page'
      ? str(args?.url) || parsedPath || ''
      : toolName === 'read_files'
        ? parsedFiles || ''
        : parsedPath || argPath
    return {
      type: 'file_read',
      label: toolName === 'code_intelligence' ? 'Анализ кода' : 'Прочитал',
      targetName,
      ...(toolName === 'code_intelligence' ? { analysisDetail: formatAnalysisDetail(args) } : {})
    }
  }
  if (toolName === 'sqlite_inspect_database' || toolName === 'pdf_analyze_document') {
    return {
      type: 'file_read',
      label: toolName === 'sqlite_inspect_database' ? 'Анализ SQLite' : 'Анализ PDF',
      targetName: parsedPath || argPath
    }
  }
  if (toolName === 'apply_patch') {
    return { type: 'terminal', label: 'Пакет правок', targetName: parsedPath || '' }
  }
  if (toolName === 'update_plan') {
    return { type: 'terminal', label: 'План задачи', targetName: '' }
  }
  if (toolName === 'verify_file') {
    return { type: 'file_read', label: 'Проверка файла', targetName: parsedPath || str(args?.path) }
  }
  if (toolName === 'spawn_agent') {
    return {
      type: 'terminal',
      label: 'Субагент',
      targetName: str(args?.role || (isStreaming ? '' : 'explorer'))
    }
  }
  if (toolName === 'ask_user') {
    return { type: 'terminal', label: 'Уточнение', targetName: '' }
  }
  if (toolName.startsWith('mcp_')) {
    return { type: 'terminal', label: 'MCP', targetName: '' }
  }
  if (toolName.startsWith('cybersec_')) {
    return {
      type: 'terminal',
      label: `CyberSec · ${CYBERSEC_TOOL_LABELS[toolName] || 'Проверка'}`,
      targetName: cyberSecTarget(toolName, args) || parsedPath || ''
    }
  }
  if (toolName.startsWith('process_')) {
    return {
      type: 'terminal',
      label: isStreaming ? 'Процесс' : (PROCESS_LABELS[toolName] || 'Процесс'),
      targetName: parsedCommand || str(args?.command || args?.process_id)
    }
  }

  return {
    type: 'terminal',
    label: 'Инструмент',
    targetName: parsedPath || ''
  }
}
