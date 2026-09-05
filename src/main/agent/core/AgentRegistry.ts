import { AgentBase } from './AgentBase'
import { ZipplyAgent } from '../agents/ZipplyAgent'
import { AskAgent } from '../agents/AskAgent'
import { TerminalAgent } from '../agents/TerminalAgent'
import { WebSearchAgent } from '../agents/WebSearchAgent'
import { WorkerAgent } from '../agents/WorkerAgent'
import { ArchitectAgent } from '../agents/ArchitectAgent'

/**
 * AgentRegistry — Central registry for all agents.
 */
export class AgentRegistry {
  private _agents: Map<string, AgentBase> = new Map()

  register(agent: AgentBase): this {
    this._agents.set(agent.id.toLowerCase(), agent)
    return this
  }

  getAgent(id: string): AgentBase {
    const normId = (id || '').toLowerCase().trim()
    let agent = this._agents.get(normId)
    if (!agent) {
      if (normId === 'zipple' || normId === 'click') {
        agent = this._agents.get('zipply')
      } else if (normId === 'task_worker' || normId === 'self' || normId === 'coder') {
        agent = this._agents.get('worker')
      } else if (normId === 'arch' || normId === 'planner' || normId === 'designer') {
        agent = this._agents.get('architect')
      }
    }
    if (!agent) throw new Error(`Agent '${id}' not found in registry.`)
    return agent
  }

  getAgents(): AgentBase[] {
    return Array.from(this._agents.values())
  }
}

// Singleton with default agents registered
export const agentRegistry = new AgentRegistry()
agentRegistry
  .register(new ZipplyAgent())
  .register(new AskAgent())
  .register(new TerminalAgent())
  .register(new WebSearchAgent())
  .register(new WorkerAgent())
  .register(new ArchitectAgent())

