import { ToolBase, ToolParameterDef, ToolResult } from './ToolBase'
import { MemoryService } from '../services/MemoryService'

/**
 * MemoryTool — Allows zipply agent to save, update, search, list, and delete long-term memories.
 *
 * Strict save policy: Only save information with genuine long-term value.
 * Use `update` to modify existing entries instead of creating duplicates.
 */
export class MemoryTool extends ToolBase {
  get name(): string {
    return 'memory'
  }

  get description(): string {
    return 'Manage long-term memory. Save ONLY high-value facts: user name/role, explicit preferences, project tech stack, ports, rules. Use update to modify existing entries. Do NOT save temporary details, code content, or obvious facts.'
  }

  getExecutionPolicy(args: Record<string, unknown> = {}) {
    const action = String(args.action || 'search').toLowerCase()
    const mutates = ['save', 'update', 'delete'].includes(action)
    return { mutates, parallelSafe: !mutates, cacheable: !mutates }
  }

  get parameters(): Record<string, ToolParameterDef> {
    return {
      description: {
        type: 'string',
        description: 'Краткое действие (2-4 слова, напр. "Сохранение факта")',
        required: false
      },
      action: {
        type: 'string',
        enum: ['save', 'update', 'search', 'list', 'delete'],
        description:
          'Operation: save (store new fact/preference), update (modify existing by id), search (find by text), list (by category), delete (by id)',
        required: true
      },
      content: {
        type: 'string',
        description: '[Required for save; optional for update/search] Fact content or search query',
        required: false
      },
      category: {
        type: 'string',
        enum: ['user_preference', 'project_fact', 'procedural_workflow', 'fact'],
        description:
          'Category: user_preference (habits/name/style), project_fact (stack/ports/rules), procedural_workflow (how-to), fact (general)',
        required: false
      },
      subject: {
        type: 'string',
        description: 'Optional entity or topic identifier (e.g. "package_manager", "database", "node_version") for automatic conflict resolution and overwriting outdated facts.',
        required: false
      },
      importance: {
        type: 'integer',
        description: 'Importance 1-5 (5=critical rule, 4=strong preference, 3=useful context). Default: 3',
        required: false
      },
      tags: {
        type: 'string',
        description: 'Comma-separated tags for retrieval (e.g. "react, typescript, auth")',
        required: false
      },
      id: {
        type: 'string',
        description: '[Required for update, delete] Memory ID (e.g. mem_...)',
        required: false
      }
    }
  }

  async execute(argumentsJson: string, blackboard?: any): Promise<ToolResult> {
    let args: any = {}
    try {
      args = JSON.parse(argumentsJson || '{}')
    } catch {
      return { formattedContent: 'Error: Invalid JSON arguments.' }
    }

    const { action, content, category, subject, importance, tags, id } = args
    const workspacePath = blackboard && typeof blackboard.getArtifact === 'function'
      ? (blackboard.getArtifact('workspacePath') as string)
      : undefined

    // --- SAVE ---
    if (action === 'save') {
      if (!content || !content.trim()) {
        return { formattedContent: 'Error: "content" is required for saving memory.' }
      }

      const tagArray =
        typeof tags === 'string'
          ? tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : Array.isArray(tags)
            ? tags
            : []

      const result = MemoryService.addMemory({
        content,
        category: category || 'fact',
        subject: typeof subject === 'string' ? subject.trim() : undefined,
        importance: Number(importance) || 3,
        tags: tagArray,
        workspacePath
      })

      const scopeLabel = result.scope === 'project' ? 'Project Brain (.zipply/memory.json)' : 'Global User Profile'

      // Exact duplicate — silently updated
      if (result.duplicate && !result.item) {
        return {
          formattedContent: `⚠️ Similar memory already exists in ${scopeLabel} (ID: ${result.duplicate.id}):\n"${result.duplicate.content}"\n\nUse action="update" with id="${result.duplicate.id}" to modify it instead of creating a duplicate.`,
          data: result.duplicate
        }
      }

      if (result.duplicate && result.item && result.item.id === result.duplicate.id) {
        return {
          formattedContent: `Memory refreshed in ${scopeLabel} (exact match updated). ID: ${result.item.id}, Importance: ${result.item.importance}/5`,
          data: result.item
        }
      }

      return {
        formattedContent: `✅ Saved to long-term memory [${scopeLabel}]. ID: ${result.item?.id}, Category: ${result.item?.category}, Importance: ${result.item?.importance}/5`,
        data: result.item
      }
    }

    // --- UPDATE ---
    if (action === 'update') {
      if (!id) {
        return { formattedContent: 'Error: "id" is required for action="update".' }
      }

      const tagArray =
        typeof tags === 'string'
          ? tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : Array.isArray(tags)
            ? (tags as string[])
            : undefined

      const patch: any = {}
      if (content !== undefined) patch.content = content
      if (category !== undefined) patch.category = category
      if (subject !== undefined) patch.subject = subject
      if (importance !== undefined) patch.importance = Number(importance)
      if (tagArray !== undefined) patch.tags = tagArray

      if (Object.keys(patch).length === 0) {
        return { formattedContent: 'Error: No fields provided to update (content, category, importance, tags).' }
      }

      const updated = MemoryService.updateMemory(id, patch, workspacePath)
      if (!updated) {
        return { formattedContent: `Error: Memory ID "${id}" not found.` }
      }

      return {
        formattedContent: `✅ Memory updated. ID: ${updated.id}, Importance: ${updated.importance}/5\nNew content: "${updated.content}"`,
        data: updated
      }
    }

    // --- SEARCH ---
    if (action === 'search') {
      const results = MemoryService.searchMemories(content || '', category || null)
      if (results.length === 0) {
        return { formattedContent: 'No matching memories found.' }
      }

      const formatted = results
        .map(
          (m, idx) =>
            `${idx + 1}. [${m.category.toUpperCase()}] (Importance ${m.importance}/5) ID: ${m.id}\n   ${m.content}${
              m.tags && m.tags.length ? ` [tags: ${m.tags.join(', ')}]` : ''
            }`
        )
        .join('\n')

      return { formattedContent: `Found ${results.length} memories:\n${formatted}`, data: results }
    }

    // --- LIST ---
    if (action === 'list') {
      const list = MemoryService.getAllMemories(workspacePath)
      if (list.length === 0) {
        return { formattedContent: 'Long-term memory is empty.' }
      }

      const formatted = list
        .map((m) => `- ID: ${m.id} | [${m.category}] (${m.importance}/5) ${m.content}`)
        .join('\n')

      return { formattedContent: `Total ${list.length} memories:\n${formatted}`, data: list }
    }

    // --- DELETE ---
    if (action === 'delete') {
      if (!id) {
        return { formattedContent: 'Error: "id" is required for action="delete".' }
      }
      const success = MemoryService.deleteMemory(id, workspacePath)
      return {
        formattedContent: success
          ? `✅ Memory ID "${id}" deleted.`
          : `Error: Memory ID "${id}" not found.`
      }
    }

    return { formattedContent: `Unknown action: ${action}` }
  }
}
