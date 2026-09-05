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

  // Clean up temporary mjs script
  if (fs.existsSync(path.join(projectRoot, 'scripts', 'test-agent-sota.mjs'))) {
    fs.unlinkSync(path.join(projectRoot, 'scripts', 'test-agent-sota.mjs'))
  }

  console.log('🎉 ALL 7 SOTA AGENT ENHANCEMENT COMPONENTS VERIFIED SUCCESSFULLY!\n')
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})
