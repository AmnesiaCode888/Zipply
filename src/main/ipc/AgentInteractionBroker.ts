import { ipcMain } from 'electron'
import type { ChatConfig } from '../agent/services/ChatService'
import { explainCommand } from '../agent/services/CommandExplanation'
import type { AgentEvent, QuestionAnswer, QuestionRequest } from '../../shared/agentEvents'
import { mcpToolTrustFingerprint } from '../agent/mcp/McpTrustStore'
import type { ToolApprovalRequest } from '../agent/tools/ToolBase'
import type { AuthService } from '../services/AuthService'
import type { AgentExtensionServices } from './agentIpcTypes'

interface PendingApproval {
  senderId: number
  requestId: string
  command: string
  serverId?: string
  mcpServerInstanceId?: string
  toolId?: string
  toolName?: string
  trustFingerprint?: string
  settings: ChatConfig
  explanationController?: AbortController
  resolve: (approved: boolean) => void
}

interface PendingQuestion {
  senderId: number
  requestId: string
  count: number | null
  resolve: (answer: QuestionAnswer) => void
}

interface PendingUncensoredPrompt {
  senderId: number
  requestId: string
  sessionId: string
  resolve: (enabled: boolean) => void
}

export interface InteractionContext {
  sender: Electron.WebContents
  requestId: string
  sessionId?: string
  signal: AbortSignal
  isCurrent: () => boolean
  runSettings: ChatConfig
}

/**
 * Coordinates interactive renderer prompts (approvals, user questions, uncensored consent, command explanations).
 */
export class AgentInteractionBroker {
  private approvals = new Map<string, PendingApproval>()
  private questions = new Map<string, PendingQuestion>()
  private uncensoredPrompts = new Map<string, PendingUncensoredPrompt>()

  constructor(
    private readonly extensions: AgentExtensionServices,
    private readonly auth?: AuthService
  ) {}

  resolveApprovalsForServer(serverId: string): void {
    for (const pending of this.approvals.values()) {
      if (pending.serverId === serverId) pending.resolve(false)
    }
  }

  rejectApprovalsForRequest(senderId: number, requestId: string): void {
    for (const pending of this.approvals.values()) {
      if (pending.senderId === senderId && pending.requestId === requestId) pending.resolve(false)
    }
  }

  createPromptUncensoredMode(ctx: InteractionContext): () => Promise<boolean> {
    return () => new Promise((resolve) => {
      const { sender, requestId, sessionId, signal, isCurrent } = ctx
      if (!isCurrent() || signal.aborted || sender.isDestroyed() || typeof sessionId !== 'string' || !sessionId) {
        return resolve(false)
      }
      const promptId = `uncensored_${Date.now()}_${Math.random().toString(36).slice(2)}`
      let done = false
      const finish = (enabled: boolean): void => {
        if (done) return
        done = true
        this.uncensoredPrompts.delete(promptId)
        signal.removeEventListener('abort', onAbort)
        sender.removeListener('destroyed', onAbort)
        resolve(enabled && isCurrent() && !signal.aborted && !sender.isDestroyed())
      }
      const onAbort = (): void => finish(false)
      this.uncensoredPrompts.set(promptId, { senderId: sender.id, requestId, sessionId, resolve: finish })
      signal.addEventListener('abort', onAbort, { once: true })
      sender.once('destroyed', onAbort)
      const prompt: AgentEvent = { type: 'uncensored_mode_prompt', promptId, sessionId, requestId }
      try { sender.send('agent:event', prompt) }
      catch { finish(false) }
    })
  }

  createAskUser(ctx: InteractionContext): (question: QuestionRequest) => Promise<QuestionAnswer> {
    return (question) => new Promise((resolve) => {
      const { sender, requestId, signal, isCurrent } = ctx
      if (!isCurrent() || signal.aborted || sender.isDestroyed()) return resolve(null)
      const questionId = `question_${Date.now()}_${Math.random().toString(36).slice(2)}`
      let done = false
      const finish = (answer: QuestionAnswer): void => {
        if (done) return
        done = true
        this.questions.delete(questionId)
        signal.removeEventListener('abort', onAbort)
        sender.removeListener('destroyed', onAbort)
        resolve(signal.aborted ? null : answer)
      }
      const onAbort = (): void => finish(null)
      this.questions.set(questionId, {
        senderId: sender.id,
        requestId,
        count: 'questions' in question ? question.questions.length : null,
        resolve: finish
      })
      signal.addEventListener('abort', onAbort, { once: true })
      sender.once('destroyed', onAbort)
      try { sender.send('agent:event', { type: 'question_request', questionId, ...question, requestId }) }
      catch { finish(null) }
    })
  }

  createConfirmAction(ctx: InteractionContext): (action: ToolApprovalRequest) => Promise<boolean> {
    return (action) => new Promise((resolve) => {
      const { sender, requestId, signal, isCurrent, runSettings } = ctx
      if (!isCurrent() || signal.aborted || sender.isDestroyed()) return resolve(false)
      let mcpServerInstanceId: string | undefined
      if (action.kind === 'mcp' && action.serverId && action.toolId && action.trustFingerprint) {
        try { mcpServerInstanceId = this.extensions.mcpRuntime?.getServerInstanceId(action.serverId) }
        catch { return resolve(false) }
        if (!mcpServerInstanceId) return resolve(false)
        const descriptor = this.extensions.mcpRuntime?.listTools(action.serverId).find(tool => tool.id === action.toolId)
        const definition = this.extensions.mcpConfig?.getDefinition(action.serverId)
        if (!descriptor || !definition || mcpToolTrustFingerprint(action.serverId, descriptor, definition) !== action.trustFingerprint) {
          return resolve(false)
        }
        try {
          if (this.extensions.mcpTrust?.isTrusted(action.serverId, action.toolId, action.trustFingerprint)) {
            return resolve(true)
          }
        } catch { /* Corrupt trust state fails closed and asks for a fresh decision. */ }
      }
      const approvalId = `approval_${Date.now()}_${Math.random().toString(36).slice(2)}`
      const finish = (approved: boolean): void => {
        this.approvals.get(approvalId)?.explanationController?.abort()
        this.approvals.delete(approvalId)
        signal.removeEventListener('abort', onAbort)
        sender.removeListener('destroyed', onDestroyed)
        resolve(approved && !signal.aborted)
      }
      const onAbort = (): void => finish(false)
      const onDestroyed = (): void => finish(false)
      this.approvals.set(approvalId, {
        senderId: sender.id,
        requestId,
        command: action.command,
        serverId: action.serverId,
        mcpServerInstanceId,
        toolId: action.toolId,
        toolName: action.toolName,
        trustFingerprint: action.trustFingerprint,
        settings: {
          ...runSettings,
          ...(this.auth ? { authFetch: (pathOrUrl: string, init?: RequestInit) => this.auth!.authorizedFetch(pathOrUrl, init) } : {})
        },
        resolve: finish
      })
      signal.addEventListener('abort', onAbort, { once: true })
      sender.once('destroyed', onDestroyed)
      try { sender.send('agent:event', { type: 'approval_request', approvalId, ...action, requestId }) }
      catch { finish(false) }
    })
  }

  register(): void {
    ipcMain.on('agent:approval', (event, { requestId, approvalId, approved, trustTool }) => {
      if (event.senderFrame !== event.sender.mainFrame) return
      const pending = this.approvals.get(approvalId)
      if (!pending || pending.senderId !== event.sender.id || pending.requestId !== requestId) return

      let accepted = approved === true
      if (accepted && pending.mcpServerInstanceId) {
        try {
          const descriptor = pending.serverId && pending.toolId
            ? this.extensions.mcpRuntime?.listTools(pending.serverId).find(tool => tool.id === pending.toolId)
            : undefined
          const definition = pending.serverId ? this.extensions.mcpConfig?.getDefinition(pending.serverId) : undefined
          accepted = Boolean(
            pending.serverId &&
            pending.toolId &&
            pending.trustFingerprint &&
            this.extensions.mcpRuntime?.getServerInstanceId(pending.serverId) === pending.mcpServerInstanceId &&
            descriptor &&
            definition &&
            mcpToolTrustFingerprint(pending.serverId, descriptor, definition) === pending.trustFingerprint
          )
        } catch {
          accepted = false
        }
      }
      if (accepted && trustTool === true && pending.serverId && pending.toolId && pending.toolName && pending.trustFingerprint) {
        try { this.extensions.mcpTrust?.trust(pending.serverId, pending.toolId, pending.toolName, pending.trustFingerprint) }
        catch { /* The current call may be allowed, but trust is not persisted if storage fails. */ }
      }
      pending.resolve(accepted)
    })

    ipcMain.on('agent:uncensoredModeAnswer', (event, payload: unknown) => {
      if (event.senderFrame !== event.sender.mainFrame || !payload || typeof payload !== 'object') return
      const { requestId, sessionId, promptId, enabled } = payload as Record<string, unknown>
      if (typeof promptId !== 'string' || typeof enabled !== 'boolean') return
      const pending = this.uncensoredPrompts.get(promptId)
      if (pending && pending.senderId === event.sender.id && pending.requestId === requestId && pending.sessionId === sessionId) {
        pending.resolve(enabled)
      }
    })

    ipcMain.on('agent:answer', (event, { requestId, questionId, answer }) => {
      const pending = this.questions.get(questionId)
      if (!pending || pending.senderId !== event.sender.id || pending.requestId !== requestId) return
      const validText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 4000
      if (answer === null) pending.resolve(null)
      else if (pending.count === null && validText(answer)) pending.resolve(answer.trim())
      else if (pending.count !== null && Array.isArray(answer) && answer.length === pending.count && answer.every(validText)) {
        pending.resolve(answer.map((value: string) => value.trim()))
      }
    })

    ipcMain.handle('agent:explainCommand', async (event, { requestId, approvalId }) => {
      const pending = this.approvals.get(approvalId)
      if (!pending || pending.senderId !== event.sender.id || pending.requestId !== requestId) {
        return { error: 'Подтверждение команды больше недоступно.' }
      }
      if (pending.explanationController) return { error: 'Объяснение уже запрашивается.' }
      const controller = new AbortController()
      pending.explanationController = controller
      try {
        const explanation = await explainCommand(pending.command, pending.settings, controller.signal)
        return { explanation }
      } catch {
        return { error: 'Не удалось получить объяснение. Проверьте подключение и настройки модели и попробуйте снова.' }
      } finally {
        if (this.approvals.get(approvalId) === pending) pending.explanationController = undefined
      }
    })
  }
}
