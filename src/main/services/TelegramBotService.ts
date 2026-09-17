import * as fs from 'fs'
import * as path from 'path'
import { BrowserWindow } from 'electron'
import { LocalStorageService } from './LocalStorageService'
import { AgentRunner, AgentEvent } from '../agent/core/AgentRunner'
import { agentRegistry } from '../agent/core/AgentRegistry'
import { ChatConfig } from '../agent/services/ChatService'
import { OpenAiMessage } from '../agent/core/ContextCompactor'

export interface TelegramConfig {
  token: string
  enabled: boolean
  allowedUsers: string[]
  autoStart: boolean
  defaultWorkspace?: string
  syncWithActiveChat?: boolean
  notifyOnDesktopDone?: boolean
}

export interface TelegramBotInfo {
  id: number
  username: string
  firstName: string
}

export interface TelegramBotStatus {
  status: 'stopped' | 'starting' | 'running' | 'error'
  botInfo?: TelegramBotInfo
  error?: string
  lastActiveAt?: string
  currentModel?: string
}

export interface ToolStepLog {
  id: string
  emoji: string
  action: string
  detail: string
  isDone: boolean
  startedAt: number
  durationSeconds?: number
}

interface ActiveTask {
  controller: AbortController
  messageId?: number
  chatId: number
  targetChatId: string
  startTime: number
  prompt: string
  toolSteps: ToolStepLog[]
}

const DEFAULT_CONFIG: TelegramConfig = {
  token: '',
  enabled: false,
  allowedUsers: [],
  autoStart: false,
  defaultWorkspace: '',
  syncWithActiveChat: true,
  notifyOnDesktopDone: true
}

export class TelegramBotService {
  private static _status: TelegramBotStatus = { status: 'stopped' }
  private static _abortController: AbortController | null = null
  private static _activeTasks: Map<number, ActiveTask> = new Map()
  private static _pollingPromise: Promise<void> | null = null
  private static _lastUpdateId = 0

  // Two-way synchronization state
  private static _activeDesktopChatId: string | null = null
  private static _userBoundChatId: Map<number, string> = new Map()
  private static _knownChatIds: Set<number> = new Set()

  // Interactive search & pagination state
  private static _pendingAction: Map<number, { type: 'search_model' | 'search_project'; messageId?: number }> = new Map()
  private static _modelsCache: Array<{ id: string; name: string }> = []
  private static _projectsCache: Array<{ name: string; path: string }> = []
  private static _userModelPage: Map<number, { page: number; query?: string }> = new Map()
  private static _userProjectPage: Map<number, { page: number; query?: string }> = new Map()

  // --------------------------------------------------------------------------
  // Static Validation & Helper Utilities (Used in Tests and Core)
  // --------------------------------------------------------------------------

  static isValidTokenFormat(token: string): boolean {
    if (!token || typeof token !== 'string') return false
    return /^\d{7,15}:[A-Za-z0-9_-]{30,50}$/.test(token.trim())
  }

  static isUserAllowed(allowedList: string[], userId: number, username?: string): boolean {
    if (!Array.isArray(allowedList) || allowedList.length === 0) {
      return false
    }
    const cleanId = String(userId).trim()
    const cleanUser = (username || '').replace(/^@/, '').toLowerCase().trim()

    return allowedList.some((item) => {
      const entry = item.replace(/^@/, '').toLowerCase().trim()
      if (!entry) return false
      return entry === cleanId || (cleanUser && entry === cleanUser)
    })
  }

  static splitMessage(text: string, maxLength = 3900): string[] {
    if (!text) return ['']
    if (text.length <= maxLength) return [text]

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining)
        break
      }

      let breakIndex = remaining.lastIndexOf('\n', maxLength)
      if (breakIndex === -1 || breakIndex < maxLength * 0.7) {
        breakIndex = remaining.lastIndexOf(' ', maxLength)
      }
      if (breakIndex === -1 || breakIndex < maxLength * 0.5) {
        breakIndex = maxLength
      }

      chunks.push(remaining.slice(0, breakIndex))
      remaining = remaining.slice(breakIndex).trimStart()
    }

    return chunks
  }

  // --------------------------------------------------------------------------
  // Telegram Bot API Formatting: Clean Markdown -> Telegram HTML
  // --------------------------------------------------------------------------

  static formatMarkdownToTelegramHtml(text: string): string {
    if (!text) return ''

    // 1. Protect code blocks
    const codeBlocks: string[] = []
    let processed = text.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (_, lang, code) => {
      const escapedCode = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      const idx = codeBlocks.length
      const langAttr = lang ? ` class="language-${lang.toLowerCase()}"` : ''
      codeBlocks.push(`<pre><code${langAttr}>${escapedCode}</code></pre>`)
      return `@@TGCODE${idx}@@`
    })

    // 2. Protect inline code
    const inlineCodes: string[] = []
    processed = processed.replace(/`([^`\n]+)`/g, (_, code) => {
      const escaped = code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      const idx = inlineCodes.length
      inlineCodes.push(`<code>${escaped}</code>`)
      return `@@TGINLINE${idx}@@`
    })

    // 3. Escape HTML special characters in the text
    processed = processed
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    // 4. Headers (# Header -> <b>Header</b>)
    processed = processed.replace(/^#{1,6}\s+(.+)$/gm, '\n<b>$1</b>')

    // 5. Bold (**text** or __text__)
    processed = processed.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    processed = processed.replace(/__(.+?)__/g, '<b>$1</b>')

    // 6. Italic (*text* or _text_)
    processed = processed.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, '<i>$1</i>')
    processed = processed.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<i>$1</i>')

    // 7. Markdown links [text](url) -> <a href="url">text</a>
    processed = processed.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')

    // 8. Blockquotes (> text or &gt; text after HTML escaping)
    processed = processed.replace(/^(?:>|&gt;)\s+(.+)$/gm, '<blockquote>$1</blockquote>')

    // 9. Bullet lists (- item or * item)
    processed = processed.replace(/^[-*]\s+(.+)$/gm, '• $1')

    // 10. Restore code blocks & inline code
    processed = processed.replace(/@@TGCODE(\d+)@@/g, (_, i) => codeBlocks[Number(i)] || '')
    processed = processed.replace(/@@TGINLINE(\d+)@@/g, (_, i) => inlineCodes[Number(i)] || '')

    return processed.trim()
  }

  static getToolEmojiAndAction(
    toolName: string,
    args: Record<string, any> = {}
  ): { emoji: string; action: string; detail: string } {
    const normName = (toolName || '').toLowerCase().trim()

    if (normName === 'search_web') {
      const q = (args.query || args.prompt || '').toString().slice(0, 60)
      return { emoji: '🔍', action: 'Веб-поиск', detail: q ? `«${q}»` : '' }
    }

    if (normName === 'grep_search') {
      const q = (args.query || args.pattern || '').toString().slice(0, 45)
      const p = (args.path || args.dir || '').toString()
      const target = p ? ` в ${path.basename(p)}` : ''
      return { emoji: '🔎', action: 'Поиск в коде', detail: q ? `«${q}»${target}` : '' }
    }

    if (normName === 'file') {
      const act = (args.action || 'view').toString().toLowerCase()
      const p = (args.path || args.file || '').toString()
      const fileBase = p ? path.basename(p) : 'файл'
      if (act === 'read' || act === 'view') {
        return { emoji: '📖', action: 'Чтение файла', detail: fileBase }
      }
      if (act === 'write' || act === 'create') {
        return { emoji: '📄', action: 'Создание файла', detail: fileBase }
      }
      if (act === 'edit' || act === 'replace') {
        return { emoji: '✏️', action: 'Редактирование', detail: fileBase }
      }
      if (act === 'list' || act === 'list_dir') {
        return { emoji: '📁', action: 'Список файлов', detail: fileBase }
      }
      return { emoji: '📄', action: 'Файл', detail: `${act}: ${fileBase}` }
    }

    if (normName === 'terminal') {
      const cmd = (args.command || args.cmd || '').toString().trim()
      return { emoji: '💻', action: 'Терминал', detail: cmd ? cmd.slice(0, 50) : '' }
    }

    if (normName === 'browser') {
      const act = (args.action || 'navigate').toString()
      const url = (args.url || '').toString().slice(0, 45)
      return { emoji: '🌐', action: 'Браузер', detail: url ? `${act}: ${url}` : act }
    }

    if (normName === 'memory') {
      const act = (args.action || 'search').toString()
      return { emoji: '🧠', action: 'Память', detail: act }
    }

    if (normName === 'read_skill' || normName === 'save_skill') {
      const name = (args.name || '').toString()
      return { emoji: '⚡', action: 'Навык', detail: name }
    }

    if (normName === 'call_mcp_tool') {
      const mcpTool = (args.toolName || args.name || '').toString()
      return { emoji: '🔌', action: 'MCP', detail: mcpTool }
    }

    if (normName === 'ask_agent') {
      const ag = (args.agent_id || 'ask').toString()
      return { emoji: '🤖', action: 'Сабагент', detail: ag }
    }

    return { emoji: '🔧', action: 'Инструмент', detail: toolName }
  }

  // --------------------------------------------------------------------------
  // Model Management
  // --------------------------------------------------------------------------

  static getAvailableModels(): Array<{ id: string; name: string }> {
    const aiConfig = LocalStorageService.getStore<any>('config', {})
    const modelsMap = new Map<string, string>()

    if (aiConfig.model) {
      modelsMap.set(aiConfig.model, aiConfig.model)
    }

    if (Array.isArray(aiConfig.connectedProviders)) {
      for (const p of aiConfig.connectedProviders) {
        if (p && Array.isArray(p.models)) {
          for (const m of p.models) {
            if (m && typeof m === 'string') modelsMap.set(m, `${m} (${p.name || p.providerId})`)
          }
        }
        if (p && p.model && typeof p.model === 'string') {
          modelsMap.set(p.model, `${p.model} (${p.name || p.providerId})`)
        }
      }
    }

    const defaults = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'deepseek-chat',
      'deepseek-reasoner',
      'claude-3-7-sonnet',
      'claude-3-5-haiku',
      'gpt-4o',
      'gpt-4o-mini',
      'qwen2.5-coder-32b'
    ]
    for (const d of defaults) {
      if (!modelsMap.has(d)) {
        modelsMap.set(d, d)
      }
    }

    return Array.from(modelsMap.entries()).map(([id, name]) => ({ id, name }))
  }

  static async setModel(newModel: string): Promise<string> {
    const clean = (newModel || '').trim()
    if (!clean) return ''

    const aiConfig = LocalStorageService.getStore<any>('config', {})
    aiConfig.model = clean
    LocalStorageService.setStore('config', aiConfig, 0)
    this._broadcast('config:changed', { model: clean })
    console.log(`[TelegramBotService] Model changed to: ${clean}`)
    return clean
  }

  // --------------------------------------------------------------------------
  // Synchronization API: Track Desktop State & Push Notifications
  // --------------------------------------------------------------------------

  static setActiveDesktopChatId(chatId: string | null): void {
    this._activeDesktopChatId = chatId
    console.log('[TelegramBotService] Active desktop chat synced:', chatId)
  }

  static getActiveDesktopChatId(): string | null {
    return this._activeDesktopChatId
  }

  static async notifyDesktopTaskCompleted(chatId: string, title?: string, summary?: string): Promise<void> {
    const config = this.getConfig()
    if (!config.enabled || config.notifyOnDesktopDone === false || !config.token) return
    if (this._knownChatIds.size === 0) return

    const chatTitle = title || 'Диалог Zipply'
    const snippet = summary ? this._escapeHtml(summary.slice(0, 250)) : 'Задача успешно завершена.'
    const text = `🖥️ <b>Задача на компьютере завершена!</b>\n\nДиалог: <b>${this._escapeHtml(chatTitle)}</b>\n\n${snippet}`

    for (const tgChatId of this._knownChatIds) {
      await this._sendTelegramMessage(config.token, tgChatId, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Синхронизировать этот диалог', callback_data: `bind_chat:${chatId}` }]
          ]
        }
      })
    }
  }

  // --------------------------------------------------------------------------
  // Configuration & State
  // --------------------------------------------------------------------------

  static getConfig(): TelegramConfig {
    try {
      const stored = LocalStorageService.getStore<TelegramConfig>('telegram_config', DEFAULT_CONFIG)
      return { ...DEFAULT_CONFIG, ...stored }
    } catch {
      return { ...DEFAULT_CONFIG }
    }
  }

  static async saveConfig(patch: Partial<TelegramConfig>): Promise<TelegramConfig> {
    const current = this.getConfig()
    const updated: TelegramConfig = {
      ...current,
      ...patch,
      allowedUsers: Array.isArray(patch.allowedUsers)
        ? patch.allowedUsers.map((u) => u.trim()).filter(Boolean)
        : current.allowedUsers
    }
    LocalStorageService.setStore('telegram_config', updated, 0)
    this._broadcastStatus()
    return updated
  }

  static getStatus(): TelegramBotStatus {
    const aiConfig = LocalStorageService.getStore<any>('config', {})
    return {
      ...this._status,
      currentModel: aiConfig.model || 'По умолчанию'
    }
  }

  // --------------------------------------------------------------------------
  // Telegram Bot API Client
  // --------------------------------------------------------------------------

  private static async _callApi<T = any>(
    token: string,
    method: string,
    payload?: Record<string, any>,
    signal?: AbortSignal
  ): Promise<{ ok: boolean; result?: T; description?: string; error_code?: number }> {
    const url = `https://api.telegram.org/bot${token.trim()}/${method}`
    const options: RequestInit = {
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal
    }

    try {
      const resp = await fetch(url, options)
      const data = await resp.json()
      return data
    } catch (err: unknown) {
      if (signal?.aborted) {
        return { ok: false, description: 'Request aborted' }
      }
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, description: msg }
    }
  }

  private static async _sendTelegramMessage(
    token: string,
    chatId: number | string,
    text: string,
    options?: { reply_markup?: any; parse_mode?: string }
  ): Promise<any> {
    const parseMode = options?.parse_mode ?? 'HTML'
    const res = await this._callApi(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      reply_markup: options?.reply_markup
    })

    if (!res.ok && res.description?.toLowerCase().includes("can't parse entities")) {
      console.warn('[TelegramBotService] HTML parse error, falling back to plain text:', res.description)
      const plain = text.replace(/<[^>]+>/g, '')
      return this._callApi(token, 'sendMessage', {
        chat_id: chatId,
        text: plain,
        reply_markup: options?.reply_markup
      })
    }

    return res
  }

  private static async _editTelegramMessage(
    token: string,
    chatId: number | string,
    messageId: number,
    text: string,
    options?: { reply_markup?: any; parse_mode?: string }
  ): Promise<any> {
    const parseMode = options?.parse_mode ?? 'HTML'
    const res = await this._callApi(token, 'editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode,
      reply_markup: options?.reply_markup
    })

    if (!res.ok && res.description?.toLowerCase().includes("can't parse entities")) {
      console.warn('[TelegramBotService] Edit HTML parse error, falling back to plain text:', res.description)
      const plain = text.replace(/<[^>]+>/g, '')
      return this._callApi(token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: plain,
        reply_markup: options?.reply_markup
      })
    }

    return res
  }

  static async testToken(token: string): Promise<{ valid: boolean; botInfo?: TelegramBotInfo; error?: string }> {
    if (!this.isValidTokenFormat(token)) {
      return { valid: false, error: 'Неверный формат токена бота. Пример: 123456789:ABCdef...' }
    }

    const res = await this._callApi(token, 'getMe')
    if (res.ok && res.result) {
      return {
        valid: true,
        botInfo: {
          id: res.result.id,
          username: res.result.username,
          firstName: res.result.first_name
        }
      }
    }
    return {
      valid: false,
      error: res.description || `Ошибка проверки токена (код ${res.error_code || 'неизвестно'})`
    }
  }

  // --------------------------------------------------------------------------
  // Lifecycle: Init, Start, Stop
  // --------------------------------------------------------------------------

  static async init(): Promise<void> {
    const config = this.getConfig()
    if (config.enabled && config.autoStart && config.token) {
      console.log('[TelegramBotService] Autostarting Telegram Bot on launch...')
      try {
        await this.start()
      } catch (err) {
        console.warn('[TelegramBotService] Autostart failed:', err)
      }
    }
  }

  static async start(): Promise<TelegramBotStatus> {
    const config = this.getConfig()
    if (!config.token || !this.isValidTokenFormat(config.token)) {
      this._status = {
        status: 'error',
        error: 'Токен Telegram-бота не задан или имеет неверный формат.'
      }
      this._broadcastStatus()
      return this.getStatus()
    }

    if (this._status.status === 'running') {
      return this.getStatus()
    }

    this._status = { status: 'starting' }
    this._broadcastStatus()

    const test = await this.testToken(config.token)
    if (!test.valid || !test.botInfo) {
      this._status = {
        status: 'error',
        error: test.error || 'Не удалось подключиться к Telegram Bot API.'
      }
      this._broadcastStatus()
      return this.getStatus()
    }

    this._status = {
      status: 'running',
      botInfo: test.botInfo,
      lastActiveAt: new Date().toISOString()
    }
    await this.saveConfig({ enabled: true })

    this._abortController = new AbortController()
    this._pollingPromise = this._runPollingLoop(config.token, this._abortController.signal)
    this._broadcastStatus()

    console.log(`[TelegramBotService] Bot @${test.botInfo.username} successfully started!`)
    return this.getStatus()
  }

  static async stop(): Promise<void> {
    if (this._status.status === 'stopped') return

    console.log('[TelegramBotService] Stopping Telegram Bot...')
    if (this._abortController) {
      this._abortController.abort()
      this._abortController = null
    }

    for (const [, task] of this._activeTasks.entries()) {
      try {
        task.controller.abort()
      } catch {}
    }
    this._activeTasks.clear()

    this._status = { status: 'stopped' }
    await this.saveConfig({ enabled: false })
    this._broadcastStatus()
  }

  private static _broadcast(channel: string, data: any): void {
    try {
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(channel, data)
        }
      }
    } catch {}
  }

  private static _broadcastStatus(): void {
    this._broadcast('telegram:status', this.getStatus())
  }

  // --------------------------------------------------------------------------
  // Long Polling Loop
  // --------------------------------------------------------------------------

  private static async _runPollingLoop(token: string, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const payload: Record<string, any> = {
          offset: this._lastUpdateId + 1,
          timeout: 25,
          allowed_updates: ['message', 'callback_query']
        }

        const res = await this._callApi<any[]>(token, 'getUpdates', payload, signal)
        if (signal.aborted) break

        if (res.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            if (update.update_id > this._lastUpdateId) {
              this._lastUpdateId = update.update_id
            }
            this._handleUpdate(token, update).catch((err) => {
              console.error('[TelegramBotService] Error handling update:', err)
            })
          }
        } else if (!res.ok) {
          console.warn('[TelegramBotService] getUpdates warning:', res.description)
          await new Promise((r) => setTimeout(r, 3000))
        }
      } catch (err: unknown) {
        if (signal.aborted) break
        console.warn('[TelegramBotService] Polling exception:', err)
        await new Promise((r) => setTimeout(r, 4000))
      }
    }
  }

  // --------------------------------------------------------------------------
  // Update Dispatcher
  // --------------------------------------------------------------------------

  private static async _handleUpdate(token: string, update: any): Promise<void> {
    const config = this.getConfig()

    // Handle Callback Query (inline buttons)
    if (update.callback_query) {
      if (update.callback_query.message?.chat?.id) {
        this._knownChatIds.add(update.callback_query.message.chat.id)
      }
      await this._handleCallbackQuery(token, update.callback_query)
      return
    }

    // Handle Messages
    if (update.message) {
      const msg = update.message
      const chatId = msg.chat?.id
      const from = msg.from
      const text = (msg.text || '').trim()

      if (!chatId || !from) return
      this._knownChatIds.add(chatId)

      // Security Verification
      const isAllowed = this.isUserAllowed(config.allowedUsers, from.id, from.username)
      if (!isAllowed) {
        const deniedText =
          `⛔ <b>Доступ ограничен!</b>\n\n` +
          `Ваш Telegram ID: <code>${from.id}</code>\n` +
          (from.username ? `Username: @${this._escapeHtml(from.username)}\n\n` : '\n') +
          `Чтобы получить доступ к управлению компьютером, добавьте ваш ID в настройках Zipply (раздел <b>«Доступ»</b>) на вашем ПК.`

        await this._sendTelegramMessage(token, chatId, deniedText)
        return
      }

      // Handle Slash Commands
      if (text.startsWith('/')) {
        this._pendingAction.delete(chatId)
        await this._handleCommand(token, chatId, text, from)
        return
      }

      // Check if user is in search mode
      const pending = this._pendingAction.get(chatId)
      if (pending && text) {
        this._pendingAction.delete(chatId)
        if (pending.type === 'search_model') {
          await this._sendModelsKeyboard(token, chatId, { query: text, page: 0, messageId: pending.messageId })
          return
        }
        if (pending.type === 'search_project') {
          await this._sendProjectsKeyboard(token, chatId, { query: text, page: 0, messageId: pending.messageId })
          return
        }
      }

      // Handle Regular Chat Prompt for Agent
      if (text) {
        await this._executeAgentTurn(token, chatId, text)
      }
    }
  }

  // --------------------------------------------------------------------------
  // Commands Routing
  // --------------------------------------------------------------------------

  private static async _handleCommand(token: string, chatId: number, commandText: string, from: any): Promise<void> {
    const parts = commandText.split(/\s+/)
    const cmd = parts[0].toLowerCase().split('@')[0]
    const args = parts.slice(1).join(' ')

    switch (cmd) {
      case '/start': {
        const config = this.getConfig()
        const workspace = config.defaultWorkspace || LocalStorageService.getDefaultProjectsDir()
        const aiConfig = LocalStorageService.getStore<any>('config', {})
        const model = aiConfig.model || 'По умолчанию'

        const currentTarget = this._resolveTargetChat(chatId)

        const text =
          `👋 <b>Привет, ${this._escapeHtml(from.first_name || 'друг')}!</b>\n\n` +
          `Я <b>Zipply Bot</b> — ваш удалённый доступ к компьютеру.\n\n` +
          `🔄 <b>Синхронизированный диалог:</b> «${this._escapeHtml(currentTarget.currentChat.title)}»\n` +
          `🧠 <b>Модель ИИ:</b> <code>${this._escapeHtml(model)}</code>\n` +
          `📂 <b>Рабочая папка:</b> <code>${this._escapeHtml(path.basename(workspace) || workspace)}</code>\n\n` +
          `💬 Все сообщения, которые вы отправляете сюда, автоматически появляются в Zipply на компьютере в реальном времени.`

        const replyMarkup = {
          inline_keyboard: [
            [
              { text: '🔄 Синхронизировать с ПК', callback_data: 'cmd:sync' },
              { text: '💬 Выбрать диалог', callback_data: 'cmd:list_chats' }
            ],
            [
              { text: '🧠 Сменить модель', callback_data: 'cmd:list_models' },
              { text: '📁 Проекты', callback_data: 'cmd:list_projects' }
            ],
            [
              { text: '📜 История', callback_data: 'cmd:show_history' },
              { text: '⚡ Статус', callback_data: 'cmd:get_status' }
            ],
            [
              { text: '➕ Новый диалог', callback_data: 'cmd:new_chat' },
              { text: '❓ Помощь', callback_data: 'cmd:show_help' }
            ]
          ]
        }

        await this._sendTelegramMessage(token, chatId, text, { reply_markup: replyMarkup })
        break
      }

      case '/help': {
        const helpText =
          `📖 <b>Команды Zipply Bot:</b>\n\n` +
          `• <code>/start</code> — главное меню и статус\n` +
          `• <code>/model</code> — выбор или смена ИИ-модели\n` +
          `• <code>/sync</code> — мгновенно синхронизироваться с открытым на ПК диалогом\n` +
          `• <code>/chats</code> — список диалогов на компьютере для переключения\n` +
          `• <code>/newchat</code> — начать чистый новый диалог на компьютере\n` +
          `• <code>/projects</code> — переключить рабочий проект\n` +
          `• <code>/history</code> — посмотреть последние задачи\n` +
          `• <code>/status</code> — статус системы и модели\n` +
          `• <code>/stop</code> — остановить текущую выполняющуюся задачу\n\n` +
          `💬 Отправьте любое текстовое сообщение — оно сразу выполнится агентом и отобразится на мониторе!`

        await this._sendTelegramMessage(token, chatId, helpText)
        break
      }

      case '/model':
      case '/models': {
        if (args) {
          const newModel = await this.setModel(args)
          await this._sendTelegramMessage(
            token,
            chatId,
            `✅ <b>Модель изменена!</b>\n\nТекущая модель: <code>${this._escapeHtml(newModel)}</code>`
          )
        } else {
          await this._sendModelsKeyboard(token, chatId)
        }
        break
      }

      case '/sync': {
        await this._syncWithDesktopChat(token, chatId)
        break
      }

      case '/chats': {
        await this._sendChatsKeyboard(token, chatId)
        break
      }

      case '/stop': {
        const active = this._activeTasks.get(chatId)
        if (active) {
          active.controller.abort()
          this._activeTasks.delete(chatId)
          await this._sendTelegramMessage(token, chatId, '⏹ <b>Выполнение текущей задачи остановлено.</b>')
        } else {
          await this._sendTelegramMessage(token, chatId, 'ℹ️ В данный момент нет активных выполняющихся задач.')
        }
        break
      }

      case '/newchat': {
        await this._createNewChatSession(token, chatId)
        break
      }

      case '/status': {
        await this._sendStatusMessage(token, chatId)
        break
      }

      case '/history': {
        await this._sendHistoryMessage(token, chatId)
        break
      }

      case '/projects': {
        await this._sendProjectsKeyboard(token, chatId)
        break
      }

      default:
        await this._sendTelegramMessage(
          token,
          chatId,
          `Неизвестная команда <code>${this._escapeHtml(cmd)}</code>. Введите /help для справки.`
        )
        break
    }
  }

  // --------------------------------------------------------------------------
  // Callback Queries (Inline Keyboard Buttons)
  // --------------------------------------------------------------------------

  private static async _handleCallbackQuery(token: string, cb: any): Promise<void> {
    const cbId = cb.id
    const data = cb.data || ''
    const chatId = cb.message?.chat?.id
    const messageId = cb.message?.message_id

    await this._callApi(token, 'answerCallbackQuery', { callback_query_id: cbId })
    if (!chatId || !messageId) return

    // Stop task
    if (data === 'action:stop') {
      const active = this._activeTasks.get(chatId)
      if (active) {
        active.controller.abort()
        this._activeTasks.delete(chatId)

        let stepsText = ''
        if (active.toolSteps.length > 0) {
          stepsText = '\n\n📋 <b>Выполненные шаги:</b>\n'
          for (const s of active.toolSteps) {
            const detailPart = s.detail ? ` <code>${this._escapeHtml(s.detail)}</code>` : ''
            stepsText += `• ${s.emoji} <b>${s.action}</b>${detailPart}\n`
          }
        }

        await this._editTelegramMessage(
          token,
          chatId,
          messageId,
          `⏹ <b>Задача остановлена пользователем.</b>\nВыполнение было прервано по вашей команде.${stepsText}`
        )
      } else {
        await this._callApi(token, 'editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] }
        })
      }
      return
    }

    if (data === 'cmd:sync') {
      await this._syncWithDesktopChat(token, chatId)
      return
    }

    if (data === 'cmd:list_chats') {
      await this._sendChatsKeyboard(token, chatId)
      return
    }

    if (data === 'cmd:list_models') {
      await this._sendModelsKeyboard(token, chatId, { page: 0, messageId })
      return
    }

    if (data.startsWith('m_s:') || data.startsWith('set_model:')) {
      let modelId = ''
      if (data.startsWith('m_s:')) {
        const idx = parseInt(data.replace('m_s:', ''), 10)
        const chosen = this._modelsCache[idx]
        modelId = chosen ? chosen.id : ''
      } else {
        modelId = data.replace('set_model:', '')
      }

      if (modelId) {
        await this.setModel(modelId)
        await this._editTelegramMessage(
          token,
          chatId,
          messageId,
          `✅ <b>Модель переключена!</b>\n\nНовая активная модель: <code>${this._escapeHtml(modelId)}</code>\n\nВсе последующие задачи будут выполняться на этой модели.`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🧠 К списку моделей', callback_data: 'cmd:list_models' },
                  { text: '⚡ Статус', callback_data: 'cmd:get_status' }
                ]
              ]
            }
          }
        )
      }
      return
    }

    if (data.startsWith('m_p:')) {
      const page = parseInt(data.replace('m_p:', ''), 10)
      const userState = this._userModelPage.get(chatId)
      await this._sendModelsKeyboard(token, chatId, { page, query: userState?.query, messageId })
      return
    }

    if (data === 'm_search') {
      this._pendingAction.set(chatId, { type: 'search_model', messageId })
      await this._editTelegramMessage(
        token,
        chatId,
        messageId,
        `🔍 <b>Поиск ИИ-модели:</b>\n\nОтправьте в чат часть названия модели (например: <code>claude</code>, <code>deepseek</code>, <code>gemini</code>, <code>4o</code>):\n\n<i>Или используйте /models &lt;поиск&gt; в любой момент.</i>`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'm_cancel' }]]
          }
        }
      )
      return
    }

    if (data === 'm_clear') {
      this._userModelPage.delete(chatId)
      await this._sendModelsKeyboard(token, chatId, { page: 0, query: '', messageId })
      return
    }

    if (data === 'm_cancel') {
      this._pendingAction.delete(chatId)
      const userState = this._userModelPage.get(chatId)
      await this._sendModelsKeyboard(token, chatId, { page: userState?.page || 0, query: userState?.query, messageId })
      return
    }

    if (data.startsWith('bind_chat:')) {
      const targetChatId = data.replace('bind_chat:', '')
      const allChats = LocalStorageService.getStore<any[]>('chats', [])
      const found = allChats.find((c) => c && c.id === targetChatId)
      if (found) {
        this._userBoundChatId.set(chatId, targetChatId)
        this._broadcast('scheduler:selectChat', targetChatId)

        const msgCount = Array.isArray(found.messages) ? found.messages.length : 0
        const lastMsg = msgCount > 0 ? found.messages[msgCount - 1]?.text : ''
        const snippet = lastMsg ? `\n\nПоследнее сообщение:\n<i>${this._escapeHtml(lastMsg.slice(0, 150))}</i>` : ''

        await this._editTelegramMessage(
          token,
          chatId,
          messageId,
          `🔄 <b>Диалог синхронизирован!</b>\n\n` +
            `Активный диалог: <b>${this._escapeHtml(found.title)}</b>\n` +
            `Сообщений: ${msgCount}` +
            snippet +
            `\n\nВсе новые сообщения в Telegram сразу отправляются в этот диалог и отображаются на компьютере.`
        )
      }
      return
    }

    if (data === 'cmd:new_chat') {
      await this._createNewChatSession(token, chatId)
      return
    }

    if (data === 'cmd:list_projects') {
      await this._sendProjectsKeyboard(token, chatId, { page: 0, messageId })
      return
    }

    if (data.startsWith('p_s:') || data.startsWith('proj:')) {
      const selectedIndex = parseInt(data.replace(/^p_s:|^proj:/, ''), 10)
      const projects = this._projectsCache.length > 0 ? this._projectsCache : await this._getAvailableProjects()
      const chosen = projects[selectedIndex]
      if (chosen) {
        await this.saveConfig({ defaultWorkspace: chosen.path })
        await this._editTelegramMessage(
          token,
          chatId,
          messageId,
          `✅ <b>Рабочая папка переключена!</b>\n\nТекущий проект: <code>${this._escapeHtml(chosen.name)}</code>\nПуть: <code>${this._escapeHtml(chosen.path)}</code>`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📁 К списку проектов', callback_data: 'cmd:list_projects' },
                  { text: '⚡ Статус', callback_data: 'cmd:get_status' }
                ]
              ]
            }
          }
        )
      }
      return
    }

    if (data.startsWith('p_p:')) {
      const page = parseInt(data.replace('p_p:', ''), 10)
      const userState = this._userProjectPage.get(chatId)
      await this._sendProjectsKeyboard(token, chatId, { page, query: userState?.query, messageId })
      return
    }

    if (data === 'p_search') {
      this._pendingAction.set(chatId, { type: 'search_project', messageId })
      await this._editTelegramMessage(
        token,
        chatId,
        messageId,
        `🔍 <b>Поиск проекта:</b>\n\nОтправьте в чат название проекта или его часть:\n\n<i>Или используйте /projects &lt;поиск&gt; в любой момент.</i>`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Отмена', callback_data: 'p_cancel' }]]
          }
        }
      )
      return
    }

    if (data === 'p_clear') {
      this._userProjectPage.delete(chatId)
      await this._sendProjectsKeyboard(token, chatId, { page: 0, query: '', messageId })
      return
    }

    if (data === 'p_cancel') {
      this._pendingAction.delete(chatId)
      const userState = this._userProjectPage.get(chatId)
      await this._sendProjectsKeyboard(token, chatId, { page: userState?.page || 0, query: userState?.query, messageId })
      return
    }

    if (data === 'cmd:show_history') {
      await this._sendHistoryMessage(token, chatId)
      return
    }

    if (data === 'cmd:get_status') {
      await this._sendStatusMessage(token, chatId)
      return
    }

    if (data === 'cmd:show_help') {
      await this._sendTelegramMessage(
        token,
        chatId,
        `💡 <b>Синхронизация и команды:</b>\n\n` +
          `• Используйте /sync, чтобы мгновенно подключиться к диалогу, открытому на мониторе компьютера.\n` +
          `• Используйте /model или /models, чтобы искать и менять ИИ-модели.\n` +
          `• Используйте /projects, чтобы искать и выбирать рабочие проекты.\n` +
          `• Используйте /chats, чтобы выбрать любой диалог из списка.\n` +
          `• Все ваши ответы сразу появляются на экране ПК.\n` +
          `• Во время работы задачи доступна кнопка [⏹ Остановить].`
      )
      return
    }

    if (data === 'noop') {
      return
    }
  }

  // --------------------------------------------------------------------------
  // Agent Execution Pipeline with Step-by-Step Tool Logging & Rich HTML
  // --------------------------------------------------------------------------

  private static async _executeAgentTurn(token: string, chatId: number, prompt: string): Promise<void> {
    if (this._activeTasks.has(chatId)) {
      await this._sendTelegramMessage(
        token,
        chatId,
        '⚠️ <b>Предыдущая задача ещё выполняется!</b>\nВы можете нажать кнопку «Остановить задачу» или отправить /stop.'
      )
      return
    }

    // 1. Resolve target chat session
    const { currentChat, isNew } = this._resolveTargetChat(chatId, prompt)
    const allChats = LocalStorageService.getStore<any[]>('chats', [])

    // 2. Append User Message
    const userMsg: any = {
      id: `msg-${Date.now()}-u`,
      role: 'user',
      text: prompt,
      segments: [{ id: `seg-${Date.now()}-u`, type: 'text', content: prompt }]
    }
    currentChat.messages.push(userMsg)

    const foundIndex = allChats.findIndex((c) => c && c.id === currentChat.id)
    if (foundIndex >= 0) {
      allChats[foundIndex] = currentChat
    } else {
      allChats.unshift(currentChat)
    }
    LocalStorageService.setStore('chats', allChats, 0)

    // BROADCAST to Desktop UI in real-time
    if (isNew) {
      this._broadcast('scheduler:chatCreated', { chat: currentChat })
    }
    this._broadcast('scheduler:chatUpdated', { chatId: currentChat.id, chat: currentChat })

    // 3. Initial Telegram Status Message with Stop button
    const controller = new AbortController()
    const task: ActiveTask = {
      controller,
      chatId,
      targetChatId: currentChat.id,
      startTime: Date.now(),
      prompt,
      toolSteps: []
    }
    this._activeTasks.set(chatId, task)

    const initialText =
      `⏳ <b>Принято в диалог «${this._escapeHtml(currentChat.title)}»</b>\n` +
      `<i>«${this._escapeHtml(prompt)}»</i>\n\n` +
      `Запускаю агент Zipply...`

    const initialMsg = await this._sendTelegramMessage(token, chatId, initialText, {
      reply_markup: {
        inline_keyboard: [[{ text: '⏹ Остановить задачу', callback_data: 'action:stop' }]]
      }
    })

    if (initialMsg.ok && initialMsg.result) {
      task.messageId = initialMsg.result.message_id
    }

    // 4. Build Agent History
    const history: OpenAiMessage[] = currentChat.messages
      .filter((m: any) => m && m.text)
      .slice(-12)
      .map((m: any) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.text || ''
      }))

    const config = this.getConfig()
    const aiConfig = (LocalStorageService.getStore('config', {}) as ChatConfig) || {}
    const effectiveWorkspace =
      currentChat.project?.path ||
      config.defaultWorkspace ||
      aiConfig.workspacePath ||
      aiConfig.baseDir ||
      LocalStorageService.getDefaultProjectsDir()

    let accumulatedOutput = ''
    let lastEditTime = Date.now()

    const updateStatusMessage = async (force = false) => {
      if (!task.messageId) return
      const now = Date.now()
      if (!force && now - lastEditTime < 1800) {
        return
      }

      lastEditTime = now
      const elapsed = Math.round((now - task.startTime) / 1000)

      let statusBody =
        `⏳ <b>Диалог:</b> «${this._escapeHtml(currentChat.title)}» (${elapsed} сек)\n` +
        `<i>«${this._escapeHtml(prompt.slice(0, 120))}»</i>\n\n`

      if (task.toolSteps.length > 0) {
        statusBody += `📋 <b>Выполняемые шаги:</b>\n`
        const displaySteps = task.toolSteps.slice(-5)
        for (const s of displaySteps) {
          const icon = s.isDone ? '✅' : '⏳'
          const dur = s.durationSeconds ? ` (${s.durationSeconds}s)` : ''
          const detail = s.detail ? ` <code>${this._escapeHtml(s.detail)}</code>` : ''
          statusBody += `${icon} ${s.emoji} <b>${s.action}</b>${detail}${dur}\n`
        }
      } else if (accumulatedOutput) {
        const preview = accumulatedOutput.trim().slice(-120)
        statusBody += `💭 <b>Ответ:</b> <i>${this._escapeHtml(preview)}...</i>\n`
      } else {
        statusBody += `💭 <b>Анализирую задачу и подбираю инструменты...</b>\n`
      }

      await this._editTelegramMessage(token, chatId, task.messageId, statusBody, {
        reply_markup: {
          inline_keyboard: [[{ text: '⏹ Остановить задачу', callback_data: 'action:stop' }]]
        }
      })
    }

    const onAgentEvent = (evt: AgentEvent) => {
      // Relay event to desktop so desktop UI streams tools, thoughts, and text in real-time!
      this._broadcast('agent:event', {
        ...evt,
        isScheduled: true,
        chatId: currentChat.id,
        requestId: `tg-${task.startTime}`
      })

      if (evt.type === 'token') {
        accumulatedOutput += evt.content
        updateStatusMessage(false)
      } else if (evt.type === 'tool_start') {
        const stepInfo = this.getToolEmojiAndAction(evt.toolName, evt.args)
        const step: ToolStepLog = {
          id: evt.callId || `step-${Date.now()}`,
          emoji: stepInfo.emoji,
          action: stepInfo.action,
          detail: stepInfo.detail,
          isDone: false,
          startedAt: Date.now()
        }
        task.toolSteps.push(step)
        updateStatusMessage(true)
      } else if (evt.type === 'tool_result') {
        const targetStep = evt.callId
          ? task.toolSteps.find((s) => s.id === evt.callId)
          : task.toolSteps[task.toolSteps.length - 1]
        if (targetStep) {
          targetStep.isDone = true
          targetStep.durationSeconds = Math.max(0.1, Math.round((Date.now() - targetStep.startedAt) / 100) / 10)
        }
        updateStatusMessage(true)
      }
    }

    const agent = agentRegistry.getAgent('zipply')
    let finalSuccess = false
    let errorMessage = ''

    try {
      await AgentRunner.run(
        agent,
        history,
        {
          ...aiConfig,
          workspacePath: effectiveWorkspace,
          baseDir: effectiveWorkspace,
          chatId: currentChat.id
        },
        onAgentEvent,
        controller.signal
      )
      finalSuccess = true
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        errorMessage = 'Остановлено пользователем.'
      } else {
        errorMessage = err instanceof Error ? err.message : String(err)
      }
    } finally {
      this._activeTasks.delete(chatId)
    }

    // 5. Update Status Message with ALL completed tool steps PERMANENTLY PRESERVED!
    if (task.messageId) {
      const elapsed = Math.round((Date.now() - task.startTime) / 1000)
      let finalStepsSummary = ''
      if (task.toolSteps.length > 0) {
        finalStepsSummary = `\n\n📋 <b>Выполненные шаги (${task.toolSteps.length}):</b>\n`
        for (const s of task.toolSteps) {
          const dur = s.durationSeconds ? ` (${s.durationSeconds}s)` : ''
          const detail = s.detail ? ` <code>${this._escapeHtml(s.detail)}</code>` : ''
          finalStepsSummary += `• ${s.emoji} <b>${s.action}</b>${detail}${dur}\n`
        }
      }

      const finishedHeader = finalSuccess
        ? `✅ <b>Задача выполнена</b> (${elapsed} сек)\nДиалог: «<b>${this._escapeHtml(currentChat.title)}</b>»${finalStepsSummary}`
        : `⏹ <b>Завершено с замечанием</b> (${elapsed} сек)\nДиалог: «<b>${this._escapeHtml(currentChat.title)}</b>»\n${this._escapeHtml(errorMessage)}${finalStepsSummary}`

      await this._editTelegramMessage(token, chatId, task.messageId, finishedHeader)
    }

    // 6. Send Formatted HTML Assistant Output to Telegram
    const rawResponse = (accumulatedOutput.trim() || errorMessage || 'Задача выполнена без текстового ответа.').trim()
    const formattedHtml = this.formatMarkdownToTelegramHtml(rawResponse)
    const chunks = this.splitMessage(formattedHtml, 3900)

    for (const chunk of chunks) {
      await this._sendTelegramMessage(token, chatId, chunk)
    }

    // 7. Save Assistant Message into Zipply Desktop Chat & Broadcast Update
    const assistantMsg = {
      id: `msg-${Date.now()}-a`,
      role: 'assistant',
      text: rawResponse,
      segments: [{ id: `seg-${Date.now()}-a`, type: 'text', content: rawResponse }]
    }
    currentChat.messages.push(assistantMsg)

    const updatedChats = LocalStorageService.getStore<any[]>('chats', [])
    const idx = updatedChats.findIndex((c) => c && c.id === currentChat.id)
    if (idx >= 0) {
      updatedChats[idx] = currentChat
    } else {
      updatedChats.unshift(currentChat)
    }
    LocalStorageService.setStore('chats', updatedChats, 0)

    // Broadcast final update to desktop
    this._broadcast('scheduler:chatUpdated', { chatId: currentChat.id, chat: currentChat })
  }

  // --------------------------------------------------------------------------
  // Chat Resolution & Management
  // --------------------------------------------------------------------------

  private static _resolveTargetChat(chatId: number, initialPrompt?: string): { currentChat: any; isNew: boolean } {
    const allChats = LocalStorageService.getStore<any[]>('chats', [])
    const config = this.getConfig()

    const boundId = this._userBoundChatId.get(chatId)
    if (boundId) {
      const found = allChats.find((c) => c && c.id === boundId)
      if (found) {
        if (!Array.isArray(found.messages)) found.messages = []
        return { currentChat: found, isNew: false }
      }
    }

    if (config.syncWithActiveChat !== false && this._activeDesktopChatId) {
      const activeDesktop = allChats.find((c) => c && c.id === this._activeDesktopChatId)
      if (activeDesktop) {
        if (!Array.isArray(activeDesktop.messages)) activeDesktop.messages = []
        this._userBoundChatId.set(chatId, activeDesktop.id)
        return { currentChat: activeDesktop, isNew: false }
      }
    }

    if (allChats.length > 0 && allChats[0] && allChats[0].id) {
      const recent = allChats[0]
      if (!Array.isArray(recent.messages)) recent.messages = []
      this._userBoundChatId.set(chatId, recent.id)
      return { currentChat: recent, isNew: false }
    }

    const newChat = {
      id: `chat-tg-${Date.now()}`,
      title: initialPrompt ? `Telegram: ${initialPrompt.slice(0, 28)}` : 'Telegram: Новый диалог',
      messages: [],
      dateGroup: 'Сегодня'
    }
    this._userBoundChatId.set(chatId, newChat.id)
    return { currentChat: newChat, isNew: true }
  }

  private static async _syncWithDesktopChat(token: string, chatId: number): Promise<void> {
    const allChats = LocalStorageService.getStore<any[]>('chats', [])
    let targetChat: any = null

    if (this._activeDesktopChatId) {
      targetChat = allChats.find((c) => c && c.id === this._activeDesktopChatId)
    }

    if (!targetChat && allChats.length > 0) {
      targetChat = allChats[0]
    }

    if (!targetChat) {
      await this._createNewChatSession(token, chatId)
      return
    }

    this._userBoundChatId.set(chatId, targetChat.id)
    const msgCount = Array.isArray(targetChat.messages) ? targetChat.messages.length : 0
    const lastMsg = msgCount > 0 ? targetChat.messages[msgCount - 1]?.text : ''
    const snippet = lastMsg ? `\n\nПоследнее сообщение:\n<i>${this._escapeHtml(lastMsg.slice(0, 160))}</i>` : ''

    await this._sendTelegramMessage(
      token,
      chatId,
      `🔄 <b>Синхронизировано с диалогом на компьютере:</b>\n` +
        `«<b>${this._escapeHtml(targetChat.title)}</b>»\n` +
        `Всего сообщений: ${msgCount}` +
        snippet +
        `\n\nТеперь всё, что вы пишете сюда, сразу отображается на мониторе компьютера в этом диалоге!`
    )
  }

  private static async _createNewChatSession(token: string, chatId: number): Promise<void> {
    const allChats = LocalStorageService.getStore<any[]>('chats', [])
    const newSession = {
      id: `chat-${Date.now()}`,
      title: 'Telegram: Новый диалог',
      messages: [],
      dateGroup: 'Сегодня'
    }

    allChats.unshift(newSession)
    LocalStorageService.setStore('chats', allChats, 0)
    this._userBoundChatId.set(chatId, newSession.id)

    this._broadcast('scheduler:chatCreated', { chat: newSession })
    this._broadcast('scheduler:selectChat', newSession.id)

    await this._sendTelegramMessage(
      token,
      chatId,
      `✨ <b>Создан новый диалог на компьютере!</b>\n` +
        `Диалог сразу отобразился в списке чатов Zipply.\n\n` +
        `Отправьте первое сообщение, чтобы начать выполнение.`
    )
  }

  private static async _sendChatsKeyboard(token: string, chatId: number): Promise<void> {
    const allChats = LocalStorageService.getStore<any[]>('chats', [])
    if (allChats.length === 0) {
      await this._sendTelegramMessage(
        token,
        chatId,
        'Диалогов на компьютере пока нет. Используйте /newchat, чтобы создать первый диалог.'
      )
      return
    }

    const currentBound = this._userBoundChatId.get(chatId)
    const keyboard: Array<Array<{ text: string; callback_data: string }>> = []

    for (const c of allChats.slice(0, 6)) {
      if (!c || !c.id) continue
      const isActiveOnPc = this._activeDesktopChatId === c.id
      const isCurrent = currentBound === c.id
      const prefix = isCurrent ? '✅ ' : isActiveOnPc ? '⭐ [ПК] ' : '💬 '
      const label = `${prefix}${c.title || 'Без названия'}`.slice(0, 32)
      keyboard.push([{ text: label, callback_data: `bind_chat:${c.id}` }])
    }

    keyboard.push([{ text: '➕ Создать новый диалог', callback_data: 'cmd:new_chat' }])

    await this._sendTelegramMessage(
      token,
      chatId,
      `📂 <b>Выберите диалог Zipply для синхронизации:</b>\n\n` +
        `Выбранный диалог будет привязан к этому чату Telegram. Любое сообщение добавится в него на компьютере:`,
      { reply_markup: { inline_keyboard: keyboard } }
    )
  }

  private static async _sendModelsKeyboard(
    token: string,
    chatId: number,
    options?: { page?: number; query?: string; messageId?: number }
  ): Promise<void> {
    const aiConfig = LocalStorageService.getStore<any>('config', {})
    const currentModel = aiConfig.model || 'По умолчанию'
    const allModels = this.getAvailableModels()
    this._modelsCache = allModels

    const rawQuery = (options?.query || '').trim()
    const query = rawQuery.toLowerCase()

    let filtered = allModels
    if (query) {
      filtered = allModels.filter(
        (m) => m.id.toLowerCase().includes(query) || (m.name && m.name.toLowerCase().includes(query))
      )
    }

    const PAGE_SIZE = 8
    const totalCount = filtered.length
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    let page = options?.page ?? 0
    if (page < 0) page = 0
    if (page >= totalPages) page = totalPages - 1
    this._userModelPage.set(chatId, { page, query: rawQuery || undefined })

    const startIdx = page * PAGE_SIZE
    const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE)

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = []

    for (const m of pageItems) {
      const isCurrent = m.id === currentModel
      const prefix = isCurrent ? '✅ ' : '🧠 '
      const globalIdx = this._modelsCache.findIndex((item) => item.id === m.id)
      const label = `${prefix}${m.id}`.slice(0, 36)
      keyboard.push([{ text: label, callback_data: `m_s:${globalIdx >= 0 ? globalIdx : 0}` }])
    }

    // Pagination row
    if (totalPages > 1) {
      const navRow: Array<{ text: string; callback_data: string }> = []
      if (page > 0) {
        navRow.push({ text: '◀️ Пред.', callback_data: `m_p:${page - 1}` })
      } else {
        navRow.push({ text: '▫️', callback_data: 'noop' })
      }
      navRow.push({ text: `📄 ${page + 1} / ${totalPages}`, callback_data: 'noop' })
      if (page < totalPages - 1) {
        navRow.push({ text: 'След. ▶️', callback_data: `m_p:${page + 1}` })
      } else {
        navRow.push({ text: '▫️', callback_data: 'noop' })
      }
      keyboard.push(navRow)
    }

    // Search and Clear row
    const actionRow: Array<{ text: string; callback_data: string }> = [
      { text: '🔍 Поиск модели', callback_data: 'm_search' }
    ]
    if (rawQuery) {
      actionRow.push({ text: '❌ Сбросить фильтр', callback_data: 'm_clear' })
    }
    keyboard.push(actionRow)

    let messageText = `🧠 <b>Текущая активная модель:</b> <code>${this._escapeHtml(currentModel)}</code>\n\n`
    if (rawQuery) {
      messageText += `🔍 <b>Поиск модели:</b> «<code>${this._escapeHtml(rawQuery)}</code>» • Найдено: <b>${totalCount}</b> (стр. ${page + 1} из ${totalPages})\n\n`
    } else {
      messageText += `📋 <b>Все доступные модели</b> (${totalCount} всего, стр. ${page + 1} из ${totalPages}):\n\n`
    }
    if (filtered.length === 0) {
      messageText += `<i>Моделей по запросу «${this._escapeHtml(rawQuery)}» не найдено. Нажмите «Сбросить фильтр» или попробуйте другой запрос.</i>`
    } else {
      messageText += `<i>Нажмите на модель для выбора или отправьте /model &lt;поиск&gt;:</i>`
    }

    if (options?.messageId) {
      const editRes = await this._editTelegramMessage(token, chatId, options.messageId, messageText, {
        reply_markup: { inline_keyboard: keyboard }
      })
      if (editRes.ok) return
    }

    await this._sendTelegramMessage(token, chatId, messageText, {
      reply_markup: { inline_keyboard: keyboard }
    })
  }

  // --------------------------------------------------------------------------
  // Helpers: Status, History, Projects
  // --------------------------------------------------------------------------

  private static async _sendStatusMessage(token: string, chatId: number): Promise<void> {
    const config = this.getConfig()
    const workspace = config.defaultWorkspace || LocalStorageService.getDefaultProjectsDir()
    const aiConfig = LocalStorageService.getStore<any>('config', {})
    const activeTask = this._activeTasks.get(chatId)
    const target = this._resolveTargetChat(chatId)

    const statusText =
      `📊 <b>Статус Zipply & Синхронизации:</b>\n\n` +
      `🟢 <b>Бот:</b> В сети (@${this._status.botInfo?.username || 'Zipply'})\n` +
      `🔄 <b>Синхронизированный диалог:</b> «${this._escapeHtml(target.currentChat.title)}»\n` +
      `🧠 <b>Модель:</b> <code>${this._escapeHtml(aiConfig.model || 'не указана')}</code>\n` +
      `⚡ <b>Состояние:</b> ${activeTask ? '⏳ Выполняет задачу' : '🟢 Свободен'}\n` +
      `📁 <b>Проект:</b> <code>${this._escapeHtml(path.basename(workspace) || workspace)}</code>\n` +
      `🖥️ <b>Активный на ПК:</b> ${this._activeDesktopChatId ? 'Да' : 'Не выбран'}`

    await this._sendTelegramMessage(token, chatId, statusText, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Синхронизировать с ПК', callback_data: 'cmd:sync' },
            { text: '💬 Выбрать диалог', callback_data: 'cmd:list_chats' }
          ],
          [
            { text: '🧠 Сменить модель', callback_data: 'cmd:list_models' },
            { text: '📁 Сменить проект', callback_data: 'cmd:list_projects' }
          ]
        ]
      }
    })
  }

  private static async _sendHistoryMessage(token: string, chatId: number): Promise<void> {
    const allChats = LocalStorageService.getStore<any[]>('chats', [])
    const recent = allChats.slice(0, 6)

    if (recent.length === 0) {
      await this._sendTelegramMessage(
        token,
        chatId,
        '📜 <b>История пуста.</b> Пока не было выполнено ни одной задачи.'
      )
      return
    }

    let text = `📜 <b>Последние диалоги Zipply на компьютере:</b>\n\n`
    for (let i = 0; i < recent.length; i++) {
      const c = recent[i]
      const title = c.title || 'Без названия'
      const count = Array.isArray(c.messages) ? c.messages.length : 0
      text += `${i + 1}. <b>${this._escapeHtml(title)}</b> (${count} сообщ.)\n`
    }

    await this._sendTelegramMessage(token, chatId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: '💬 Выбрать диалог для ответа', callback_data: 'cmd:list_chats' }]]
      }
    })
  }

  private static async _getAvailableProjects(): Promise<Array<{ name: string; path: string }>> {
    const defaultBase = LocalStorageService.getDefaultProjectsDir()
    const normalProjects: Array<{ name: string; path: string }> = []
    const hiddenProjects: Array<{ name: string; path: string }> = []

    try {
      if (fs.existsSync(defaultBase)) {
        const entries = await fs.promises.readdir(defaultBase, { withFileTypes: true })
        for (const e of entries) {
          if (e.isDirectory()) {
            const item = { name: e.name, path: path.join(defaultBase, e.name) }
            if (e.name.startsWith('.')) {
              hiddenProjects.push(item)
            } else {
              normalProjects.push(item)
            }
          }
        }
      }
    } catch {}

    try {
      const stored = LocalStorageService.getStore<any[]>('projects', [])
      if (Array.isArray(stored)) {
        for (const p of stored) {
          if (
            p &&
            p.path &&
            !normalProjects.some((pr) => pr.path === p.path) &&
            !hiddenProjects.some((pr) => pr.path === p.path)
          ) {
            const name = p.name || path.basename(p.path)
            const item = { name, path: p.path }
            if (name.startsWith('.')) {
              hiddenProjects.push(item)
            } else {
              normalProjects.push(item)
            }
          }
        }
      }
    } catch {}

    normalProjects.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    hiddenProjects.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    return [...normalProjects, ...hiddenProjects]
  }

  private static async _sendProjectsKeyboard(
    token: string,
    chatId: number,
    options?: { page?: number; query?: string; messageId?: number }
  ): Promise<void> {
    const allProjects = await this._getAvailableProjects()
    this._projectsCache = allProjects

    const config = this.getConfig()
    const currentPath = config.defaultWorkspace

    const rawQuery = (options?.query || '').trim()
    const query = rawQuery.toLowerCase()

    let filtered = allProjects
    if (query) {
      filtered = allProjects.filter(
        (p) => p.name.toLowerCase().includes(query) || p.path.toLowerCase().includes(query)
      )
    }

    const PAGE_SIZE = 6
    const totalCount = filtered.length
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
    let page = options?.page ?? 0
    if (page < 0) page = 0
    if (page >= totalPages) page = totalPages - 1
    this._userProjectPage.set(chatId, { page, query: rawQuery || undefined })

    const startIdx = page * PAGE_SIZE
    const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE)

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = []

    for (const proj of pageItems) {
      const isCurrent = currentPath === proj.path
      const prefix = isCurrent ? '✅ ' : '📁 '
      const globalIdx = this._projectsCache.findIndex((item) => item.path === proj.path)
      const label = `${prefix}${proj.name}`.slice(0, 34)
      keyboard.push([{ text: label, callback_data: `p_s:${globalIdx >= 0 ? globalIdx : 0}` }])
    }

    // Pagination row
    if (totalPages > 1) {
      const navRow: Array<{ text: string; callback_data: string }> = []
      if (page > 0) {
        navRow.push({ text: '◀️ Пред.', callback_data: `p_p:${page - 1}` })
      } else {
        navRow.push({ text: '▫️', callback_data: 'noop' })
      }
      navRow.push({ text: `📄 ${page + 1} / ${totalPages}`, callback_data: 'noop' })
      if (page < totalPages - 1) {
        navRow.push({ text: 'След. ▶️', callback_data: `p_p:${page + 1}` })
      } else {
        navRow.push({ text: '▫️', callback_data: 'noop' })
      }
      keyboard.push(navRow)
    }

    // Search and Clear row
    const actionRow: Array<{ text: string; callback_data: string }> = [
      { text: '🔍 Поиск проекта', callback_data: 'p_search' }
    ]
    if (rawQuery) {
      actionRow.push({ text: '❌ Сбросить фильтр', callback_data: 'p_clear' })
    }
    keyboard.push(actionRow)

    const currentName = currentPath ? path.basename(currentPath) : 'По умолчанию'
    let messageText = `📂 <b>Рабочий проект Zipply:</b>\nТекущий: <code>${this._escapeHtml(currentName)}</code>\n\n`
    if (rawQuery) {
      messageText += `🔍 <b>Поиск проекта:</b> «<code>${this._escapeHtml(rawQuery)}</code>» • Найдено: <b>${totalCount}</b> (стр. ${page + 1} из ${totalPages})\n\n`
    } else {
      messageText += `📁 <b>Доступные проекты</b> (${totalCount} всего, стр. ${page + 1} из ${totalPages}):\n\n`
    }
    if (filtered.length === 0) {
      messageText += `<i>Проектов по запросу «${this._escapeHtml(rawQuery)}» не найдено. Нажмите «Сбросить фильтр» или создайте проект в Zipply.</i>`
    } else {
      messageText += `<i>Нажмите на проект для выбора или отправьте /projects &lt;поиск&gt;:</i>`
    }

    if (options?.messageId) {
      const editRes = await this._editTelegramMessage(token, chatId, options.messageId, messageText, {
        reply_markup: { inline_keyboard: keyboard }
      })
      if (editRes.ok) return
    }

    await this._sendTelegramMessage(token, chatId, messageText, {
      reply_markup: { inline_keyboard: keyboard }
    })
  }

  private static _escapeHtml(text: string): string {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }
}
