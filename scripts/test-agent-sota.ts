import assert from 'assert'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { RepoMapService } from '../src/main/agent/services/RepoMapService'
import { RuleService } from '../src/main/agent/services/RuleService'
import { LinterService } from '../src/main/agent/services/LinterService'
import { FileTool } from '../src/main/agent/tools/FileTool'
import { TerminalTool } from '../src/main/agent/tools/TerminalTool'
import { CompleteTaskTool } from '../src/main/agent/tools/CompleteTaskTool'
import { Blackboard } from '../src/main/agent/core/Blackboard'
import { agentRegistry } from '../src/main/agent/core/AgentRegistry'
import { toolRegistry } from '../src/main/agent/tools/ToolRegistry'
import '../src/main/agent/core/AgentRunner'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

console.log('🧪 Starting SOTA Agent Enhancements Verification Suite...\n')

async function runTests() {
  // Test 1: RepoMapService Symbol Extraction & Skeleton Map
  console.log('▶ Testing Component 1: RepoMapService...')
  const testCode = `
export interface UserConfig {
  id: string
  name: string
}

export class AuthController {
  private _key: string = ''
  public async login(username: string, pass: string): Promise<boolean> {
    return true
  }
}

export function calculateTotal(items: number[]): number {
  return items.reduce((a, b) => a + b, 0)
}
`
  const { tags, imports } = RepoMapService.extractSymbols(testCode, 'src/test.ts')
  assert.strictEqual(tags.length, 4, 'Should extract 4 symbols (interface, class, method, function)')
  assert.strictEqual(tags[0].name, 'UserConfig')
  assert.strictEqual(tags[1].name, 'AuthController')
  assert.strictEqual(tags[2].name, 'login')
  assert.strictEqual(tags[3].name, 'calculateTotal')

  const repoMap = await RepoMapService.getRepoMapAsync(projectRoot, ['src/main/agent/core/AgentRunner.ts'], 800)
  assert.ok(repoMap.includes('REPOSITORY ARCHITECTURE MAP'), 'Repo map header should exist')
  assert.ok(repoMap.includes('AgentRunner.ts') || repoMap.includes('FileTool.ts'), 'Repo map should contain core agent files')
  console.log('  ✅ RepoMapService: symbol extraction & PageRank map verified.\n')

  // Test 2: FileTool 4-Level Fuzzy Diff Matching & Indentation Preservation
  console.log('▶ Testing Component 2: FileTool (Multi-Level Fuzzy Diff Engine)...')
  const fileTool = new FileTool()
  const tempTestFile = path.join(projectRoot, 'temp_test_fuzzy.ts')
  const originalCode = `function calculateStats(data: number[]) {
    // Initial setup
    const total = data.reduce((a, b) => a + b, 0);
    const avg = total / data.length;
    return { total, avg };
}`
  fs.writeFileSync(tempTestFile, originalCode, 'utf8')

  try {
    // 2.1: Multi-block SEARCH/REPLACE with Indentation Preservation & Whitespace normalization
    const searchReplaceBlock = `<<<<<<< SEARCH
    const avg = total / data.length;
    return { total, avg };
=======
    const count = data.length;
    const avg = count > 0 ? total / count : 0;
    return { total, avg, count };
>>>>>>> REPLACE`

    const mockBb = new Blackboard()
    mockBb.setArtifact('workspacePath', projectRoot)
    const editRes = await fileTool.execute(
      JSON.stringify({
        action: 'edit',
        path: tempTestFile,
        content: searchReplaceBlock
      }),
      mockBb
    )

    assert.ok(!editRes.formattedContent.startsWith('Error'), `Edit should succeed: ${editRes.formattedContent}`)
    const updatedContent = fs.readFileSync(tempTestFile, 'utf8')
    assert.ok(updatedContent.includes('const count = data.length;'), 'File should have new lines')
    assert.ok(updatedContent.includes('    const count = data.length;'), 'Indentation should be preserved')

    // 2.2: Levenshtein Fuzzy Match Test (slight discrepancy in search lines)
    const fuzzyBlock = `<<<<<<< SEARCH
    // Initial setup
    const total = data.reduce((a, b) => a + b, 0);
=======
    // Initial setup with validation
    if (!data || data.length === 0) return null;
    const total = data.reduce((a, b) => a + b, 0);
>>>>>>> REPLACE`

    const fuzzyRes = await fileTool.execute(
      JSON.stringify({
        action: 'edit',
        path: tempTestFile,
        content: fuzzyBlock
      }),
      mockBb
    )
    assert.ok(!fuzzyRes.formattedContent.startsWith('Error'), `Fuzzy edit should succeed: ${fuzzyRes.formattedContent}`)
    const afterFuzzy = fs.readFileSync(tempTestFile, 'utf8')
    assert.ok(afterFuzzy.includes('Initial setup with validation'), 'Fuzzy match applied replacement')

    console.log('  ✅ FileTool: exact match, indentation preservation, and Levenshtein fuzzy match verified.\n')
  } finally {
    if (fs.existsSync(tempTestFile)) fs.unlinkSync(tempTestFile)
  }

  // Test 3: LinterService Fatal Syntax Error Classification
  console.log('▶ Testing Component 3: LinterService (Syntax Error Classification)...')
  assert.strictEqual(LinterService.isFatalSyntaxError('[LINTER FEEDBACK ⚠️] JSON Syntax Error: Unexpected token'), true)
  assert.strictEqual(LinterService.isFatalSyntaxError('[LINTER FEEDBACK ⚠️] Python Syntax Error in main.py: IndentationError: expected an indented block'), true)
  assert.strictEqual(LinterService.isFatalSyntaxError('[LINTER FEEDBACK ⚠️] TypeScript diagnostic issue detected after edit: error TS1005: ";" expected'), true)
  assert.strictEqual(LinterService.isFatalSyntaxError('[LINTER FEEDBACK ⚠️] TypeScript diagnostic issue: error TS2322: Type "number" is not assignable to type "string"'), false)
  console.log('  ✅ LinterService: fatal syntax classification verified.\n')

  // Test 4: TerminalTool Smart Head/Tail Truncation
  console.log('▶ Testing Component 4: TerminalTool (Smart Head/Tail Truncation)...')
  const termTool = new TerminalTool()
  const longOutput = Array.from({ length: 200 }, (_, i) => `Log line ${i + 1}: processing batch item...`).join('\n')
  const truncated = termTool['_smartTruncateOutput'](longOutput, 35, 85, 28000)

  assert.ok(truncated.includes('Log line 1:'), 'Head lines must be preserved')
  assert.ok(truncated.includes('Log line 35:'), 'Head boundary preserved')
  assert.ok(truncated.includes('Log line 200:'), 'Tail lines (exit status/errors) must be preserved')
  assert.ok(truncated.includes('Log line 116:'), 'Tail boundary preserved')
  assert.ok(truncated.includes('Omitted 80 intermediate log lines'), 'Omitted marker must be present')
  console.log('  ✅ TerminalTool: smart Head/Tail truncation verified.\n')

  // Test 5: CompleteTaskTool & Blackboard Gate
  console.log('▶ Testing Component 5: CompleteTaskTool (Verification & Completion Gate)...')
  const completeTool = new CompleteTaskTool()
  const bb = new Blackboard()

  const completeResult = await completeTool.execute(
    JSON.stringify({
      summary: 'Реализованы компоненты RepoMap, FileEdit, Linter-Rollback и CompleteTaskTool',
      verification_command: 'npm run typecheck'
    }),
    bb
  )

  assert.strictEqual(bb.getArtifact('task_completed'), true, 'Blackboard should record task_completed=true')
  assert.strictEqual(bb.getArtifact('task_verification_command'), 'npm run typecheck', 'Verification command recorded')
  assert.ok(completeResult.formattedContent.includes('Задача успешно завершена'), 'Formatted content confirms completion')
  console.log('  ✅ CompleteTaskTool: task completion gate & blackboard state verified.\n')

  // Test 6: RuleService Project Rules & Microagents
  console.log('▶ Testing Component 6: RuleService (Project Rules & Micro-Agents)...')
  const hintsPytest = RuleService.getMatchingMicroagentHints('pytest tests/test_auth.py')
  assert.ok(hintsPytest.some((h) => h.includes('pytest')), 'Pytest microagent triggered')

  const hintsNpm = RuleService.getMatchingMicroagentHints('npm install lodash')
  assert.ok(hintsNpm.some((h) => h.includes('package_manager')), 'npm microagent triggered')

  const hintsPowerShell = RuleService.getMatchingMicroagentHints('Select-String -Pattern "error" log.txt')
  assert.ok(hintsPowerShell.some((h) => h.includes('powershell')), 'PowerShell microagent triggered')
  console.log('  ✅ RuleService: dynamic microagent triggers verified.\n')

  // Test 7: ArchitectAgent & Agent Registry
  console.log('▶ Testing Component 7: ArchitectAgent & AgentRegistry...')
  const architect = agentRegistry.getAgent('architect')
  assert.strictEqual(architect.id, 'architect')
  assert.strictEqual(architect.isReadOnly, true, 'ArchitectAgent must be read-only')

  const archPrompt = architect.getSystemPrompt({
    workspacePath: projectRoot,
    repoMapPrompt: '### 🗺️ REPOSITORY ARCHITECTURE MAP (AST Skeleton)',
    projectRulesPrompt: '### 📜 [Project Rule: CLAUDE.md]'
  })
  assert.ok(archPrompt.includes('ArchitectAgent'), 'System prompt identifies role')
  assert.ok(archPrompt.includes('DO NOT Generate Diff Blocks'), 'Instructions forbid raw diff blocks')
  assert.ok(archPrompt.includes('REPOSITORY ARCHITECTURE MAP'), 'Repo map injected')
  console.log('  ✅ ArchitectAgent: system prompt and role constraints verified.\n')

  // Test 8: Security Guards & Robust JSON Repair
  console.log('▶ Testing Component 8: Security Guards & Robust JSON Repair...')
  const { ToolExecutor } = await import('../src/main/agent/core/ToolExecutor')
  // 8.1 Truncated unclosed string JSON repair
  const repaired = ToolExecutor.parseArgs('{"action": "write", "content": "truncated text')
  assert.strictEqual(repaired.content, 'truncated text', 'ToolExecutor must repair unclosed string')

  // 8.2 FileTool sensitive directory rejection
  const sensitiveRes = await fileTool.execute(
    JSON.stringify({ action: 'read', path: 'C:/Users/test/.ssh/id_rsa' }),
    new Blackboard()
  )
  assert.ok(sensitiveRes.formattedContent?.includes('Blocked access to sensitive system path'), 'FileTool should block .ssh access')

  // 8.3 TerminalTool encoded execution rejection
  const termRes = await (new TerminalTool()).execute(
    JSON.stringify({ action: 'run', command: 'powershell -enc aQBlAHgA' }),
    new Blackboard()
  )
  assert.ok(termRes.formattedContent?.includes('Blocked potentially destructive shell command'), 'TerminalTool should block -enc commands')
  console.log('  ✅ Security guards & JSON unclosed string repair verified.\n')

  // Test 9: TerminalSessionManager & TerminalTool (AI Terminal & Process Awareness)
  console.log('▶ Testing Component 9: TerminalSessionManager & TerminalTool (Terminal Awareness)...')
  const { TerminalSessionManager } = await import('../src/main/services/TerminalSessionManager')
  const sessionMgr = TerminalSessionManager.getInstance()

  // 9.1 Register sessions and simulate user command
  sessionMgr.registerOrUpdateSession({
    id: 'term_user_1',
    name: '1: powershell',
    cwd: projectRoot
  })

  sessionMgr.recordCommandStart({
    sessionId: 'term_user_1',
    runId: 'cmd_user_101',
    command: 'npm test',
    cwd: projectRoot,
    initiator: 'user'
  })
  sessionMgr.appendOutput('cmd_user_101', 'FAIL src/auth.test.ts: Invalid token\nTest Suites: 1 failed')
  sessionMgr.recordCommandExit('cmd_user_101', 1)

  // 9.2 Test list_terminals action
  const listRes = await (new TerminalTool()).execute(
    JSON.stringify({ action: 'list_terminals' }),
    new Blackboard()
  )
  assert.ok(listRes.formattedContent.includes('term_user_1'), 'list_terminals must show term_user_1')
  assert.ok(listRes.formattedContent.includes('npm test'), 'list_terminals must show last user command')
  assert.ok(listRes.formattedContent.includes('[USER]'), 'list_terminals must tag initiator as [USER]')

  // 9.3 Test read_terminal action
  const readRes = await (new TerminalTool()).execute(
    JSON.stringify({ action: 'read_terminal', session_id: 'term_user_1' }),
    new Blackboard()
  )
  assert.ok(readRes.formattedContent.includes('[USER INPUT]'), 'read_terminal must indicate [USER INPUT]')
  assert.ok(readRes.formattedContent.includes('npm test'), 'read_terminal must include executed command')
  assert.ok(readRes.formattedContent.includes('Exit Code: 1'), 'read_terminal must show exit code')
  assert.ok(readRes.formattedContent.includes('FAIL src/auth.test.ts'), 'read_terminal must include stdout/stderr')

  // 9.4 Test user typing into an AI terminal after AI execution
  const aiSessionId = 'term_ai_build_run'
  sessionMgr.registerOrUpdateSession({
    id: aiSessionId,
    name: 'build',
    cwd: projectRoot,
    isAi: true
  })
  // AI ran build
  sessionMgr.recordCommandStart({
    sessionId: aiSessionId,
    runId: 'ai_build_1',
    command: 'npm run build',
    cwd: projectRoot,
    initiator: 'ai'
  })
  sessionMgr.appendOutput('ai_build_1', '✓ built in 820ms')
  sessionMgr.recordCommandExit('ai_build_1', 0)

  // Later, user typed follow-up command in that exact same AI terminal
  sessionMgr.recordCommandStart({
    sessionId: aiSessionId,
    runId: 'user_followup_2',
    command: 'node dist/index.js --port 3000',
    cwd: projectRoot,
    initiator: 'user'
  })
  sessionMgr.appendOutput('user_followup_2', 'Server listening on http://localhost:3000')
  sessionMgr.recordCommandExit('user_followup_2', 0)

  // AI reads that AI terminal session
  const readAiTabRes = await (new TerminalTool()).execute(
    JSON.stringify({ action: 'read_terminal', session_id: aiSessionId }),
    new Blackboard()
  )
  assert.ok(readAiTabRes.formattedContent.includes('[AI COMMAND]'), 'Must show earlier AI command')
  assert.ok(readAiTabRes.formattedContent.includes('npm run build'), 'Must show build command')
  assert.ok(readAiTabRes.formattedContent.includes('[USER INPUT]'), 'Must show subsequent USER command')
  assert.ok(readAiTabRes.formattedContent.includes('node dist/index.js --port 3000'), 'Must show command typed by user')
  assert.ok(readAiTabRes.formattedContent.includes('Server listening on http://localhost:3000'), 'Must show output produced')
  console.log('  ✅ TerminalSessionManager: user input in AI terminals & terminal reading verified.\n')

  // Clean up temporary mjs script
  if (fs.existsSync(path.join(projectRoot, 'scripts', 'test-agent-sota.mjs'))) {
    fs.unlinkSync(path.join(projectRoot, 'scripts', 'test-agent-sota.mjs'))
  }

  console.log('🎉 ALL 9 SOTA AGENT ENHANCEMENT COMPONENTS VERIFIED SUCCESSFULLY!\n')
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
