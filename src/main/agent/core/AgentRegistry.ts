import { AgentBase } from './AgentBase'
import { ZipplyAgent } from '../agents/ZipplyAgent'

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
    const agent = this._agents.get(normId) || this._agents.get('zipply')
    if (!agent) throw new Error(`Agent '${id}' not found in registry.`)
    return agent
  }

  getAgents(): AgentBase[] {
    return Array.from(this._agents.values())
  }
}

export const agentRegistry = new AgentRegistry()
agentRegistry.register(new ZipplyAgent())
