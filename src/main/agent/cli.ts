import { exec } from 'child_process'
import { randomUUID } from 'crypto'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import { runAgent } from './index'
import type { AgentEvent, AgentRunCheck, AgentRunReason, AgentRunSummary, AgentTaskOutcome, AgentUsage, AgentVerificationStatus } from '../../shared/agentEvents'
import type { SandboxAccessMode, SandboxPolicy } from '../../shared/sandbox'
import type { AgentTaskState } from './core/Blackboard'
import type { ChatConfig } from './services/ChatService'
import { terminalSessionManager } from './services/TerminalSessionManager'
import { processManager } from './services/ProcessManager'

const execAsync = promisify(exec)

export interface HeadlessRunOptions {
  prompt: string
  workspace: string
  agentId?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  apiMode?: 'chat_completions' | 'responses'
  accessMode?: SandboxAccessMode
  planMode?: boolean
  stream?: boolean
  reasoningEffort?: string
  requestTransport?: typeof fetch
  onEvent?: (event: AgentEvent) => void
  signal?: AbortSignal
  sandbox?: Partial<SandboxPolicy>
  taskState?: AgentTaskState
  runLimits?: { rounds?: number; tokens?: number; timeMs?: number }
}

export interface HeadlessRunResult {
  reason: AgentRunReason
  rounds: number
  verificationStatus: AgentVerificationStatus
  taskOutcome?: AgentTaskOutcome
  falseVerified: boolean
  usage: AgentUsage
  elapsedMs: number
  checks: AgentRunCheck[]
  unverifiedCriteria: string[]
  toolsExecuted: number
  toolsStarted: Array<{ name: string; args: Record<string, unknown> }>
  finalMessage: string
  errorMessage?: string
}

export interface EvalFixtureResponse {
  status?: number
  body?: unknown
  sseChunks?: string[]
  headers?: Record<string, string>
}

export interface EvalFixture {
  id: string
  description?: string
  prompt: string
  accessMode?: SandboxAccessMode
  planMode?: boolean
  stream?: boolean
  apiMode?: 'chat_completions' | 'responses'
  sandbox?: Partial<SandboxPolicy>
  taskState?: AgentTaskState
  runLimits?: { rounds?: number; tokens?: number; timeMs?: number }
  files?: Record<string, string>
  responses: EvalFixtureResponse[]
  expected: {
    expectedReason?: AgentRunReason
    expectedVerificationStatus?: AgentVerificationStatus
    forbiddenVerificationStatus?: AgentVerificationStatus
    expectedUsageTotal?: number
    expectedToolsExecutedCount?: number
    expectedFiles?: Record<string, { equals?: string; contains?: string[]; notContains?: string[] }>
    forbiddenFiles?: string[]
    expectedRequestMatches?: Array<{ index: number; pattern: string }>
    verifyCommand?: string
  }
}

export interface EvalFixtureOutcome {
  id: string
  description?: string
  passed: boolean
  failures: string[]
  falseVerified: boolean
  reason: AgentRunReason
  verificationStatus: AgentVerificationStatus
  usage: AgentUsage
  elapsedMs: number
  rounds: number
}

export interface EvalSuiteReport {
  timestamp: string
  total: number
  passed: number
  failed: number
  passRate: number
  falseVerifiedCount: number
  totalTokens: number
  totalElapsedMs: number
  results: EvalFixtureOutcome[]
}

export async function runSingleHeadless(options: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const startedAt = Date.now()
  let summary: AgentRunSummary | undefined
  let finalMessage = ''
  let errorMessage: string | undefined
  const toolsStarted: Array<{ name: string; args: Record<string, unknown> }> = []
  let toolsExecuted = 0
  const requestId = `headless-${randomUUID()}`
  const processOwner = { senderId: 0, sessionId: requestId, workspace: path.resolve(options.workspace) }

  const cfg: ChatConfig = {
    baseUrl: options.baseUrl,
    apiKey: options.apiKey ?? 'test-key',
    model: options.model ?? 'gpt-4o-mini',
    apiMode: options.apiMode ?? 'chat_completions',
    stream: options.stream ?? false,
    reasoningEffort: options.reasoningEffort,
    requestTransport: options.requestTransport,
    workspacePath: processOwner.workspace,
    processOwner,
    requestId,
    accessMode: options.accessMode ?? 'automatic',
    planMode: options.planMode === true,
    ...(options.sandbox ? { sandbox: options.sandbox } : {}),
    ...(options.taskState ? { taskState: options.taskState } : {}),
    ...(options.runLimits ? { runLimits: options.runLimits } : {}),
    classifyUncensoredMode: false
  }

  try {
    await runAgent(options.agentId || 'zipply', [{ role: 'user', content: options.prompt }], cfg, (evt) => {
      options.onEvent?.(evt)
      if (evt.type === 'tool_start') {
        toolsStarted.push({ name: evt.toolName, args: evt.args })
      } else if (evt.type === 'tool_result') {
        toolsExecuted++
      } else if (evt.type === 'token') {
        finalMessage += evt.content
      } else if (evt.type === 'history') {
        const last = [...evt.messages].reverse().find((m) => m.role === 'assistant' && !m.isProgressUpdate && typeof m.content === 'string')
        if (last && typeof last.content === 'string') finalMessage = last.content
      } else if (evt.type === 'run_summary') {
        summary = evt.summary
      } else if (evt.type === 'error') {
        errorMessage = evt.message
      }
    }, options.signal)
  } finally {
    await Promise.allSettled([
      terminalSessionManager.stopRequest(processOwner.senderId, requestId),
      processManager.stopRequest(processOwner, requestId)
    ])
  }

  const verificationStatus: AgentVerificationStatus = summary?.verificationStatus ?? 'unverified'
  const reason: AgentRunReason = summary?.reason ?? (errorMessage ? 'error' : 'completed')
  const unverifiedCriteria = summary?.unverifiedCriteria ?? []
  const checks = summary?.checks ?? []
  const falseVerified = verificationStatus === 'verified' && unverifiedCriteria.length > 0

  return {
    reason,
    rounds: summary?.rounds ?? 0,
    verificationStatus,
    taskOutcome: summary?.taskOutcome,
    falseVerified,
    usage: summary?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    elapsedMs: summary?.elapsedMs ?? Math.max(0, Date.now() - startedAt),
    checks,
    unverifiedCriteria,
    toolsExecuted,
    toolsStarted,
    finalMessage,
    ...(errorMessage ? { errorMessage } : {})
  }
}

async function collectFixtureFiles(targetPath: string): Promise<string[]> {
  const stat = await fs.stat(targetPath)
  if (stat.isFile()) return [targetPath]
  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => path.join(targetPath, e.name))
}

export async function runEvalSuite(fixturesPath: string): Promise<EvalSuiteReport> {
  const suiteStartedAt = Date.now()
  const files = await collectFixtureFiles(path.resolve(fixturesPath))
  if (files.length === 0) throw new Error(`Нет JSON-фикстур в ${path.resolve(fixturesPath)}.`)
  const results: EvalFixtureOutcome[] = []

  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8')
    const fixture = JSON.parse(raw) as EvalFixture
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), `zipply-eval-${fixture.id.replace(/[^a-zA-Z0-9_-]/g, '')}-`))

    if (fixture.files) {
      for (const [rel, content] of Object.entries(fixture.files)) {
        const abs = path.join(ws, rel)
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, content, 'utf8')
      }
    }

    const requestBodies: string[] = []
    let exhausted = false
    const requestTransport: typeof fetch = async (_url, request) => {
      const next = fixture.responses[requestBodies.length]
      requestBodies.push(String(request?.body ?? ''))
      if (!next) {
        exhausted = true
        return Response.json({ error: { message: 'No more scripted responses.' } }, { status: 400 })
      }
      const status = next.status ?? 200
      if (!Array.isArray(next.sseChunks)) return Response.json(next.body ?? {}, { status, headers: next.headers })
      const chunks = next.sseChunks
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          controller.close()
        }
      })
      return new Response(stream, {
        status,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ...next.headers }
      })
    }

    try {
      const outcome = await runSingleHeadless({
        prompt: fixture.prompt,
        workspace: ws,
        baseUrl: 'https://fixture.invalid/v1',
        requestTransport,
        model: 'eval-model',
        apiMode: fixture.apiMode ?? 'chat_completions',
        accessMode: fixture.accessMode ?? 'automatic',
        planMode: fixture.planMode,
        stream: fixture.stream ?? false,
        sandbox: fixture.sandbox,
        taskState: fixture.taskState,
        runLimits: fixture.runLimits
      })

      const failures: string[] = []
      if (exhausted) failures.push('The scripted provider ran out of responses.')
      const exp = fixture.expected
      if (exp.expectedReason && outcome.reason !== exp.expectedReason) {
        failures.push(`reason expected '${exp.expectedReason}', got '${outcome.reason}'`)
      }
      if (exp.expectedVerificationStatus && outcome.verificationStatus !== exp.expectedVerificationStatus) {
        failures.push(`verificationStatus expected '${exp.expectedVerificationStatus}', got '${outcome.verificationStatus}'`)
      }
      let fixtureFalseVerified = outcome.falseVerified
      if (exp.forbiddenVerificationStatus && outcome.verificationStatus === exp.forbiddenVerificationStatus) {
        failures.push(`verificationStatus must NOT be '${exp.forbiddenVerificationStatus}'`)
        if (exp.forbiddenVerificationStatus === 'verified') fixtureFalseVerified = true
      }
      if (typeof exp.expectedUsageTotal === 'number' && outcome.usage.totalTokens !== exp.expectedUsageTotal) {
        failures.push(`usage.totalTokens expected ${exp.expectedUsageTotal}, got ${outcome.usage.totalTokens}`)
      }
      if (typeof exp.expectedToolsExecutedCount === 'number' && outcome.toolsExecuted !== exp.expectedToolsExecutedCount) {
        failures.push(`toolsExecuted expected ${exp.expectedToolsExecutedCount}, got ${outcome.toolsExecuted}`)
      }
      const priorFailures = failures.length
      if (exp.expectedFiles) {
        for (const [rel, check] of Object.entries(exp.expectedFiles)) {
          const abs = path.join(ws, rel)
          let content: string
          try {
            content = await fs.readFile(abs, 'utf8')
          } catch {
            failures.push(`expected file missing: ${rel}`)
            continue
          }
          if (typeof check.equals === 'string' && content !== check.equals) {
            failures.push(`file '${rel}' content mismatch`)
          }
          for (const sub of check.contains || []) {
            if (!content.includes(sub)) failures.push(`file '${rel}' missing substring '${sub}'`)
          }
          for (const sub of check.notContains || []) {
            if (content.includes(sub)) failures.push(`file '${rel}' contains forbidden substring '${sub}'`)
          }
        }
      }
      for (const rel of exp.forbiddenFiles || []) {
        const exists = await fs.stat(path.join(ws, rel)).then(() => true, () => false)
        if (exists) failures.push(`forbidden file exists: ${rel}`)
      }
      if (outcome.verificationStatus === 'verified' && failures.length > priorFailures) fixtureFalseVerified = true
      for (const reqCheck of exp.expectedRequestMatches || []) {
        const rawReq = requestBodies[reqCheck.index] ?? ''
        let decodedText = rawReq
        try {
          const parsed = JSON.parse(rawReq) as { instructions?: string; messages?: Array<{ content?: unknown }>; input?: unknown }
          const parts = [
            typeof parsed.instructions === 'string' ? parsed.instructions : '',
            ...(Array.isArray(parsed.messages) ? parsed.messages.map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')) : []),
            parsed.input ? JSON.stringify(parsed.input) : ''
          ]
          decodedText = `${rawReq}\n${parts.join('\n')}`
        } catch {
          // Keep raw string if request body wasn't JSON
        }
        if (!new RegExp(reqCheck.pattern).test(decodedText)) {
          failures.push(`request[${reqCheck.index}] did not match /${reqCheck.pattern}/`)
        }
      }
      if (exp.verifyCommand) {
        try {
          const cleanEnv = { ...process.env }
          delete cleanEnv.NODE_TEST_CONTEXT
          await execAsync(exp.verifyCommand, { cwd: ws, windowsHide: true, timeout: 15000, env: cleanEnv })
        } catch (err) {
          failures.push(`independent verifyCommand failed: ${err instanceof Error ? err.message : String(err)}`)
          if (outcome.verificationStatus === 'verified') fixtureFalseVerified = true
        }
      }

      results.push({
        id: fixture.id,
        ...(fixture.description ? { description: fixture.description } : {}),
        passed: failures.length === 0,
        failures,
        falseVerified: fixtureFalseVerified,
        reason: outcome.reason,
        verificationStatus: outcome.verificationStatus,
        usage: outcome.usage,
        elapsedMs: outcome.elapsedMs,
        rounds: outcome.rounds
      })
    } finally {
      await fs.rm(ws, { recursive: true, force: true }).catch(() => {})
    }
  }

  const passed = results.filter((r) => r.passed).length
  const total = results.length
  return {
    timestamp: new Date().toISOString(),
    total,
    passed,
    failed: total - passed,
    passRate: Number((passed / total).toFixed(4)),
    falseVerifiedCount: results.filter((r) => r.falseVerified).length,
    totalTokens: results.reduce((sum, r) => sum + (r.usage?.totalTokens || 0), 0),
    totalElapsedMs: Math.max(0, Date.now() - suiteStartedAt),
    results
  }
}

function parseCliArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

export function headlessExitCode(result: Pick<HeadlessRunResult, 'reason' | 'taskOutcome'>): number {
  if (result.reason === 'completed') return result.taskOutcome === 'unverified' ? 3 : 0
  return result.reason === 'error' ? 1 : 3
}

function writeTraceEvent(event: AgentEvent): void {
  if (event.type === 'tool_start') {
    process.stdout.write(`${JSON.stringify({ type: event.type, callId: event.callId, toolName: event.toolName })}\n`)
  } else if (event.type === 'tool_result') {
    process.stdout.write(`${JSON.stringify({ type: event.type, callId: event.callId, error: Boolean(event.error) })}\n`)
  } else if (event.type === 'run_summary') {
    const { checks, ...summary } = event.summary
    process.stdout.write(`${JSON.stringify({ type: event.type, ...summary, checkCount: checks.length })}\n`)
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2))
  const evalTarget = typeof args.eval === 'string' ? args.eval : undefined
  const baselineOut = typeof args['baseline-out'] === 'string' ? args['baseline-out'] : undefined

  if (evalTarget) {
    const report = await runEvalSuite(evalTarget)
    if (baselineOut) {
      const absOut = path.resolve(baselineOut)
      await fs.mkdir(path.dirname(absOut), { recursive: true })
      await fs.writeFile(absOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    } else {
      process.stdout.write(`Zipply Agent Eval: ${report.passed}/${report.total} passed (falseVerified=${report.falseVerifiedCount}, tokens=${report.totalTokens}, ${report.totalElapsedMs}ms)\n`)
      for (const r of report.results) {
        process.stdout.write(`  [${r.passed ? 'PASS' : 'FAIL'}] ${r.id} (${r.reason}, ${r.verificationStatus}, ${r.usage.totalTokens} tok, ${r.elapsedMs}ms)\n`)
        for (const f of r.failures) process.stdout.write(`      - ${f}\n`)
      }
    }
    await terminalSessionManager.shutdown().catch(() => {})
    process.exitCode = report.failed > 0 ? 1 : 0
    return
  }

  const prompt = typeof args.prompt === 'string' ? args.prompt : ''
  const workspace = typeof args.workspace === 'string' ? args.workspace : process.cwd()
  if (!prompt) {
    process.stderr.write('Usage: zipply-agent --eval <dir> [--baseline-out <file>] [--json] | --prompt <text> --workspace <dir> [--base-url <url> --model <name> --reasoning-effort <effort> --api-mode <mode> --stream --jsonl]\n')
    process.exit(2)
  }

  const result = await runSingleHeadless({
    prompt,
    workspace,
    agentId: typeof args.agent === 'string' ? args.agent : 'zipply',
    baseUrl: typeof args['base-url'] === 'string' ? args['base-url'] : process.env.OPENAI_BASE_URL,
    apiKey: typeof args['api-key'] === 'string' ? args['api-key'] : process.env.OPENAI_API_KEY,
    model: typeof args.model === 'string' ? args.model : undefined,
    reasoningEffort: typeof args['reasoning-effort'] === 'string' ? args['reasoning-effort'] : undefined,
    stream: args.stream === true,
    onEvent: args.jsonl === true ? writeTraceEvent : undefined,
    apiMode: args['api-mode'] === 'responses' ? 'responses' : 'chat_completions',
    accessMode: (typeof args['access-mode'] === 'string' ? args['access-mode'] : 'automatic') as SandboxAccessMode,
    runLimits: {
      ...(typeof args['max-rounds'] === 'string' ? { rounds: Number(args['max-rounds']) } : {}),
      ...(typeof args['max-tokens'] === 'string' ? { tokens: Number(args['max-tokens']) } : {}),
      ...(typeof args['max-time-ms'] === 'string' ? { timeMs: Number(args['max-time-ms']) } : {})
    }
  })

  if (args.jsonl === true) {
    const { reason, taskOutcome, verificationStatus, usage, elapsedMs, rounds, toolsExecuted } = result
    process.stdout.write(`${JSON.stringify({ type: 'result', reason, taskOutcome, verificationStatus, usage, elapsedMs, rounds, toolsExecuted })}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  }
  await terminalSessionManager.shutdown().catch(() => {})
  process.exitCode = headlessExitCode(result)
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  void main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack || err.message : String(err)}\n`)
    process.exit(1)
  })
}
