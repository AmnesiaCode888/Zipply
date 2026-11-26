import React from 'react'
import { Message, ChatSession, ImageAttachment } from '../../types/chat'
import { MessageFeed } from './MessageFeed'
import { ChatInput } from '../chat-input'
import type { ChatDraft, ExtensionCommandOption, ExtensionManagementPage } from '../chat-input/ChatInput'
import { CommandApproval } from './CommandApproval'
import { UserQuestion } from './UserQuestion'
import { PlanLimitNotice } from '../subscription/PlanLimitNotice'
import type { AgentEvent, QuestionAnswer, QuestionRequest } from '../../../../shared/agentEvents'
import type { ExtensionRef } from '../../../../shared/extensions'

interface ChatCanvasProps {
  drafts: Map<string, ChatDraft>
  messages: Message[]
  searchTarget?: { messageId: string; sequence: number } | null
  activeSession?: ChatSession
  uncensoredMode?: boolean
  onEnableUncensoredMode?: () => void
  onChangeFolder?: () => void
  onOpenFolder?: () => void
  onSendMessage: (text: string, planMode?: boolean, attachments?: ImageAttachment[], extensionRefs?: ExtensionRef[]) => void
  extensionOptions?: readonly ExtensionCommandOption[]
  onManageExtensions?: (page: ExtensionManagementPage) => void
  isStreaming?: boolean
  onCancelStream?: () => void
  approval?: (Extract<AgentEvent, { type: 'approval_request' }> & { requestId: string }) | null
  onApproval?: (approved: boolean, trustTool?: boolean) => void
  question?: ({ requestId: string; questionId: string } & QuestionRequest) | null
  onAnswer?: (answer: QuestionAnswer) => void
  onRetry?: () => void
  planNotice?: { planLabel: string; onDismiss: () => void; onOpenPlans: () => void } | null
}

const ChatCanvasView: React.FC<ChatCanvasProps> = ({
  drafts,
  messages,
  searchTarget,
  activeSession,
  uncensoredMode,
  onEnableUncensoredMode,
  onChangeFolder,
  onOpenFolder,
  onSendMessage,
  extensionOptions,
  onManageExtensions,
  isStreaming,
  onCancelStream,
  approval,
  onApproval,
  question,
  onAnswer,
  onRetry,
  planNotice
}) => {
  const latestContext = [...messages].reverse().find(message => message.contextStatus)?.contextStatus
  const hasCompacted = messages.some(message => message.contextStatus?.compacted)
  const sessionId = activeSession?.id
  const initialDraft = React.useMemo(() => sessionId ? drafts.get(sessionId) : undefined, [drafts, sessionId])
  const saveDraft = React.useCallback((draft: ChatDraft) => {
    if (sessionId) drafts.set(sessionId, draft)
  }, [drafts, sessionId])
  return (
    <div data-chat-canvas className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-canvas">
      {/* Messages Feed */}
      <MessageFeed sessionId={activeSession?.id} messages={messages} searchTarget={searchTarget} onRetry={onRetry} folderPath={activeSession?.folderPath} />

      {approval && (
        <CommandApproval key={approval.approvalId} approval={approval} onApproval={onApproval} />
      )}
      {question && <UserQuestion key={question.questionId} question={question} onAnswer={onAnswer} />}

      {planNotice && (
        <div className="mx-auto mb-2 w-full max-w-[760px] px-4">
          <PlanLimitNotice planLabel={planNotice.planLabel} onDismiss={planNotice.onDismiss} onOpenPlans={planNotice.onOpenPlans} />
        </div>
      )}

      {/* Input Container */}
      <div className="p-4 pt-1 pb-4 flex justify-center w-full shrink-0">
        <div className="w-full max-w-[760px]">
          <ChatInput
            key={activeSession?.id}
            initialDraft={initialDraft}
            onDraftChange={sessionId ? saveDraft : undefined}
            contextStatus={latestContext}
            contextCompacted={hasCompacted}
            onSend={onSendMessage}
            extensionOptions={extensionOptions}
            onManageExtensions={onManageExtensions}
            isStreaming={isStreaming}
            onCancel={onCancelStream}
            activeSession={activeSession}
            uncensoredMode={uncensoredMode}
            onEnableUncensoredMode={onEnableUncensoredMode}
            onChangeFolder={onChangeFolder}
            onOpenFolder={onOpenFolder}
          />
        </div>
      </div>
    </div>
  )
}

export const ChatCanvas: React.FC<ChatCanvasProps> = Object.assign(
  (props: ChatCanvasProps) => ChatCanvasView(props),
  React.memo(ChatCanvasView)
)
