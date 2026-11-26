import type { AgentRunCheck, AgentUsage, AgentVerificationStatus } from './agentEvents'

export type SubagentRole = 'explorer' | 'reviewer' | 'worker'
export type SubagentStatus = 'queued' | 'running' | 'stopping' | 'interrupted' | 'completed' | 'failed' | 'cancelled'

export interface SubagentSnapshot {
  id: string
  parentId?: string
  rootRunId: string
  sessionId?: string
  role: SubagentRole
  task: string
  status: SubagentStatus
  createdAt: number
  updatedAt: number
  activity?: string
  toolCallsCount: number
  rounds?: number
  summary?: string
  error?: string
  usage?: AgentUsage
  verificationStatus?: AgentVerificationStatus
  checks?: AgentRunCheck[]
  resultData?: Record<string, unknown>
}

export interface SubagentEvent {
  type: 'update'
  subagent: SubagentSnapshot
}
