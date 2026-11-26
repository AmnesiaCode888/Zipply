import React from 'react'
import { ChatSession } from '../../types/chat'
import { ChatItem } from './ChatItem'

interface ChatListProps {
  sessions: ChatSession[]
  activeChatId: string
  approvalChatIds?: readonly string[]
  generatingTitleChatIds?: readonly string[]
  onSelectChat: (id: string) => void
  onRenameChat: (id: string, newTitle: string) => void
  onDeleteChat: (id: string) => void
}

export const ChatList: React.FC<ChatListProps> = ({
  sessions,
  activeChatId,
  approvalChatIds = [],
  generatingTitleChatIds = [],
  onSelectChat,
  onRenameChat,
  onDeleteChat
}) => {
  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-center">
        <span className="text-[14px] text-secondary">Нет чатов</span>
      </div>
    )
  }

  const waitingForApproval = new Set(approvalChatIds)

  return (
    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col pr-0.5">
      {sessions.map((session) => (
        <ChatItem
          key={session.id}
          session={session}
          isActive={session.id === activeChatId}
          waitingForApproval={waitingForApproval.has(session.id)}
          generatingTitle={generatingTitleChatIds.includes(session.id)}
          onSelect={onSelectChat}
          onRename={onRenameChat}
          onDelete={onDeleteChat}
        />
      ))}
    </div>
  )
}
