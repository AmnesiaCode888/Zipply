import fs from 'fs'
import path from 'path'

export interface ProjectRuleFile {
  name: string
  path: string
  content: string
}

export interface MicroagentRule {
  id: string
  pattern: RegExp
  hint: string
}

/**
 * RuleService — Dynamic Project Rules & Micro-Agents Engine (OpenHands / Goose / Claude Code pattern).
 * Automatically discovers project guideline files (.zipplyrules, CLAUDE.md, .cursorrules, .roomodes)
 * and provides dynamic execution hints (micro-agents) based on commands and tools.
 */
export class RuleService {
  private static readonly RULE_FILENAMES = [
    '.zipplyrules',
    'zipply.md',
    'CLAUDE.md',
    '.clinerules',
    '.cursorrules',
    '.roomodes',
    'AGENTS.md',
    '.goosehints',
    '.windsurfrules',
    path.join('.github', 'copilot-instructions.md')
  ]

  // Micro-Agent triggers: concise, high-value JIT execution tips injected into dynamic tail
  private static readonly MICROAGENTS: MicroagentRule[] = [
    {
      id: 'pytest',
      pattern: /\b(pytest|py\.test|unittest)\b/i,
      hint: '[Microagent: pytest] Always run specific test files/methods or use `--tb=short` to prevent terminal context flooding with large tracebacks.'
    },
    {
      id: 'package_manager',
      pattern: /\b(npm|pnpm|yarn|bun)\s+(install|add|i|update|remove)\b/i,
      hint: '[Microagent: package_manager] Run package installations non-interactively. For npm, prefer `npm install --no-audit --no-fund` for clean output.'
    },
    {
      id: 'git_safety',
      pattern: /\bgit\b/i,
      hint: '[Microagent: git] Never run destructive commands (`git reset --hard`, `git clean -fd`) without explicit confirmation. Always check status with `git status` first.'
    },
    {
      id: 'docker',
      pattern: /\bdocker(?:-compose)?\b/i,
      hint: '[Microagent: docker] Use `--no-stream` on stats and `--tail 50` on logs to avoid hanging terminal sessions.'
    },
    {
      id: 'powershell',
      pattern: /\b(powershell|pwsh|select-string|get-content|set-item|remove-item)\b/i,
      hint: '[Microagent: powershell] In PowerShell UTF-8, arrays are declared as `@(item1, item2)`, never `[item1, item2]`. For chained execution use `;`.'
    },
    {
      id: 'compiler_build',
      pattern: /\b(cargo|dotnet|rustc|tsc|vite build|electron-builder|gcc|g\+\+|clang)\b/i,
      hint: '[Microagent: compiler] Check build exit codes carefully. When fixing build errors, make surgical targeted edits only to the reported files and lines.'
    },
    {
      id: 'python_env',
      pattern: /\b(python|pip|venv|conda|poetry)\b/i,
      hint: '[Microagent: python] In virtual environments, ensure python/pip targets the active virtualenv. Run scripts non-interactively with `-u`.'
    },
    {
      id: 'curl_rest',
      pattern: /\b(curl|wget|http|fetch)\b/i,
      hint: '[Microagent: network] Use silent flags (`curl -s -S --max-time 15`) and format responses cleanly to avoid terminal spam.'
    }
  ]

  /**
   * Find and read all active project rule files in workspace.
   */
  static getProjectRules(workspacePath?: string): ProjectRuleFile[] {
    if (!workspacePath || !fs.existsSync(workspacePath)) return []
    const rules: ProjectRuleFile[] = []

    for (const filename of this.RULE_FILENAMES) {
      const fullPath = path.join(workspacePath, filename)
      try {
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath)
          if (stat.isFile() && stat.size > 0 && stat.size < 100 * 1024) {
            const content = fs.readFileSync(fullPath, 'utf8').trim()
            if (content) {
              rules.push({
                name: path.basename(filename),
                path: fullPath,
                content
              })
            }
          }
        }
      } catch {}
    }

    return rules
  }

  /**
   * Formats all discovered project rules into a clean system prompt section.
   */
  static getProjectRulesPrompt(workspacePath?: string): string {
    const rules = this.getProjectRules(workspacePath)
    if (rules.length === 0) return ''

    const formatted = rules
      .map((r) => `<RULE[${r.path}]>\n# Guidelines from ${r.name}\n${r.content}\n</RULE[${r.path}]>`)
      .join('\n\n')

    return formatted
  }

  /**
   * Evaluates command / text and returns triggered micro-agent hints if applicable.
   */
  static getMatchingMicroagentHints(text: string): string[] {
    if (!text || typeof text !== 'string') return []
    const matches: string[] = []

    for (const ma of this.MICROAGENTS) {
      if (ma.pattern.test(text)) {
        matches.push(ma.hint)
      }
    }

    return matches
  }
}
