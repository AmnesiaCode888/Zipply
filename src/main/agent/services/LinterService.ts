import { exec } from 'child_process'
import path from 'path'
import * as fs from 'fs'

/**
 * LinterService — Production-grade non-blocking diagnostic checker (SOTA Cursor/SWE-agent pattern).
 * Automatically verifies syntax and typing after file edits and injects actionable feedback
 * to enable zero-latency self-healing by the AI agent.
 */
export class LinterService {
  private static readonly TIMEOUT_MS = 3500

  /**
   * Identifies whether diagnostic feedback represents a fatal syntax error that broke file integrity
   * (e.g. IndentationError, JSON syntax break, missing brackets, unparseable code).
   */
  static isFatalSyntaxError(feedback?: string | null): boolean {
    if (!feedback || typeof feedback !== 'string') return false
    const lower = feedback.toLowerCase()
    return (
      lower.includes('syntax error') ||
      lower.includes('indentationerror') ||
      lower.includes('unexpected token') ||
      lower.includes('unexpected end of json') ||
      lower.includes('declaration or statement expected') ||
      lower.includes('ts1005') ||
      lower.includes('ts1109') ||
      lower.includes('ts1128') ||
      lower.includes('ts1160')
    )
  }

  /**
   * Run quick automated checks on the modified file based on its extension.
   * Returns a diagnostic feedback string if errors are found, or null if clean.
   */
  static async checkFileAsync(filePath: string, workspaceRoot: string): Promise<string | null> {
    if (!filePath || typeof filePath !== 'string') return null
    if (!fs.existsSync(filePath)) return null

    const ext = path.extname(filePath).toLowerCase()

    try {
      if (ext === '.json') {
        return await this._checkJson(filePath)
      } else if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
        return await this._checkTypeScript(filePath, workspaceRoot)
      } else if (ext === '.py') {
        return await this._checkPython(filePath)
      }
    } catch {
      // Diagnostic check failure must never break the main tool execution
    }

    return null
  }

  /**
   * Fast 0ms JSON syntax validator
   */
  private static async _checkJson(filePath: string): Promise<string | null> {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8')
      JSON.parse(content)
      return null
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const relPath = path.basename(filePath)
      return `[LINTER FEEDBACK ⚠️] JSON Syntax Error in ${relPath}:\n• ${msg}\nTip: Fix JSON syntax (check trailing commas, missing quotes or brackets) in your next step.`
    }
  }

  /**
   * TypeScript / JavaScript diagnostics via tsc if tsconfig exists
   */
  private static async _checkTypeScript(filePath: string, workspaceRoot: string): Promise<string | null> {
    const targetDir = path.dirname(filePath)
    const tsconfigInDir = path.join(targetDir, 'tsconfig.json')
    const tsconfigInWorkspace = workspaceRoot ? path.join(workspaceRoot, 'tsconfig.json') : ''

    const hasTsConfig = fs.existsSync(tsconfigInDir) || (tsconfigInWorkspace && fs.existsSync(tsconfigInWorkspace))
    if (!hasTsConfig) return null

    const cwd = fs.existsSync(tsconfigInDir) ? targetDir : workspaceRoot
    const relFile = path.relative(cwd, filePath).replace(/\\/g, '/')
    const baseName = path.basename(filePath)

    return new Promise((resolve) => {
      // Run tsc with --noEmit and short timeout
      const cmd = `npx --no-install tsc --noEmit --pretty false`

      const child = exec(cmd, { cwd, timeout: this.TIMEOUT_MS }, (error, stdout, stderr) => {
        if (!error) {
          return resolve(null) // Clean compilation!
        }

        const output = (stdout || '') + (stderr || '')
        if (!output.trim()) return resolve(null)

        const lines = output.split(/\r?\n/)
        // Filter lines relevant to the modified file
        const fileErrors = lines.filter(
          (l) => l.includes(relFile) || l.includes(baseName) || l.includes(`(${baseName}`)
        )

        const relevantLines = fileErrors.length > 0 ? fileErrors : lines.filter((l) => l.includes('error TS')).slice(0, 3)

        if (relevantLines.length > 0) {
          const formatted = relevantLines.slice(0, 4).map((l) => `  • ${l.trim()}`).join('\n')
          return resolve(
            `[LINTER FEEDBACK ⚠️] TypeScript diagnostic issue detected after edit:\n${formatted}\nTip: Review and fix the type/syntax error in your next action if necessary.`
          )
        }

        resolve(null)
      })

      // Safety timeout guard
      setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        resolve(null)
      }, this.TIMEOUT_MS + 200)
    })
  }

  /**
   * Fast Python syntax check via py_compile
   */
  private static async _checkPython(filePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32'
      const pythonCmd = isWin ? 'python' : 'python3'
      const cmd = `${pythonCmd} -m py_compile "${filePath}"`

      const child = exec(cmd, { timeout: 2000 }, (error, _stdout, stderr) => {
        if (!error) return resolve(null)

        const errOutput = (stderr || '').trim()
        if (errOutput) {
          const lines = errOutput.split(/\r?\n/).slice(-3).join('\n')
          const relPath = path.basename(filePath)
          return resolve(
            `[LINTER FEEDBACK ⚠️] Python Syntax Error in ${relPath}:\n${lines}\nTip: Correct the Python syntax in your next action.`
          )
        }
        resolve(null)
      })

      setTimeout(() => {
        try { child.kill('SIGKILL') } catch {}
        resolve(null)
      }, 2200)
    })
  }
}
