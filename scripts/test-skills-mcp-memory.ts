import assert from 'assert'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { OutputTruncator } from '../src/main/agent/core/OutputTruncator'
import { SkillService } from '../src/main/agent/services/SkillService'
import { MemoryService } from '../src/main/agent/services/MemoryService'
import { McpService } from '../src/main/agent/services/McpService'
import { MemoryTool } from '../src/main/agent/tools/MemoryTool'
import { Blackboard } from '../src/main/agent/core/Blackboard'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

console.log('🧪 Starting Skills, MCP & Memory Verification Suite...\n')

async function runTests() {
  // Test 1: OutputTruncator Head/Tail Truncation
  console.log('▶ Testing Component 1: OutputTruncator...')
  const shortOutput = 'Line 1\nLine 2\nLine 3'
  assert.strictEqual(OutputTruncator.truncate(shortOutput), shortOutput, 'Short output should not be truncated')

  const longLines: string[] = []
  for (let i = 1; i <= 500; i++) {
    longLines.push(`Log message #${i}: Execution trace data line ${i}`)
  }
  const longOutput = longLines.join('\n')
  const truncated = OutputTruncator.truncate(longOutput, 250, 60, 140)

  assert.ok(truncated.length < longOutput.length, 'Truncated output should be shorter')
  assert.ok(truncated.includes('ВЫВОД УСЕЧЕН: пропущено 300 строк'), 'Should contain omission marker with 300 omitted lines')
  assert.ok(truncated.startsWith('Log message #1:'), 'Should preserve head lines from beginning')
  assert.ok(truncated.endsWith('Log message #500: Execution trace data line 500'), 'Should preserve tail lines from end')
  console.log('  ✅ OutputTruncator: head/tail line preservation verified.\n')

  // Test 2: SkillService Upward Hierarchy & Stable Prompt
  console.log('▶ Testing Component 2: SkillService Hierarchy & Stable Catalog...')
  const hierarchy = SkillService.getHierarchyDirectories(projectRoot)
  assert.ok(hierarchy.length >= 1, 'Hierarchy should contain project root')
  assert.strictEqual(path.normalize(hierarchy[0]), path.normalize(projectRoot), 'First directory in hierarchy must be startDir')

  const stablePrompt = SkillService.getStableSkillsCatalogPrompt(projectRoot)
  if (stablePrompt) {
    assert.ok(stablePrompt.includes('<available_skills>'), 'Stable prompt should contain <available_skills> tag')
    assert.ok(stablePrompt.includes('read_skill'), 'Stable prompt should instruct using read_skill')
  }
  console.log('  ✅ SkillService: upward hierarchy traversal & prefix-stable catalog verified.\n')

  // Test 3: McpService Cache & Process Utilities
  console.log('▶ Testing Component 3: McpService Cache & Process Engine...')
  const cacheDir = McpService.getMcpCacheDir()
  assert.ok(typeof cacheDir === 'string' && cacheDir.length > 0, 'Cache dir should exist')

  McpService.cacheToolSchemas('test_server', [
    {
      name: 'query_db',
      serverName: 'test_server',
      serverId: 'srv_123',
      description: 'Execute query',
      inputSchema: { type: 'object', properties: { sql: { type: 'string' } } }
    }
  ])
  const cachedToolFile = path.join(cacheDir, 'test_server', 'query_db.json')
  assert.ok(fs.existsSync(cachedToolFile), 'Tool schema should be cached to disk for Lazy MCP mode')
  const cachedContent = JSON.parse(fs.readFileSync(cachedToolFile, 'utf-8'))
  assert.strictEqual(cachedContent.name, 'query_db')
  console.log('  ✅ McpService: disk schema caching for Lazy MCP mode verified.\n')

  // Test 4: MemoryService Subject-based Invalidation & Upsert
  console.log('▶ Testing Component 4: MemoryService Subject-based Conflict Invalidation...')
  const testSubj = `test_pkg_${Date.now()}`
  
  // Step A: Save initial fact
  const res1 = MemoryService.addMemory({
    content: 'Мы используем Yarn v1 для сборки проекта',
    category: 'project_fact',
    subject: testSubj,
    importance: 4,
    tags: ['package_manager', 'build']
  })
  assert.ok(res1.item !== null, 'Initial memory should be created')
  assert.strictEqual(res1.item?.subject, testSubj)
  assert.ok(res1.item?.content.includes('Yarn v1'))
  const memoryId = res1.item!.id

  // Step B: Save conflicting fact with SAME subject
  const res2 = MemoryService.addMemory({
    content: 'Мы перешли на pnpm v9 для всех пакетов',
    category: 'project_fact',
    subject: testSubj,
    importance: 5,
    tags: ['package_manager', 'pnpm']
  })
  assert.ok(res2.item !== null, 'Updated memory should exist')
  assert.strictEqual(res2.item?.id, memoryId, 'Should overwrite same memory ID instead of creating conflicting duplicate')
  assert.strictEqual(res2.item?.importance, 5, 'Importance should be updated to 5')
  assert.ok(res2.item?.content.includes('pnpm v9'), 'Content should be updated to fresh statement')

  // Clean up test memory
  MemoryService.deleteMemory(memoryId)
  console.log('  ✅ MemoryService: subject-based conflict invalidation and memory upsert verified.\n')

  // Test 5: MemoryTool Integration with subject
  console.log('▶ Testing Component 5: MemoryTool with Subject Parameter...')
  const memoryTool = new MemoryTool()
  const mockBb = new Blackboard()
  mockBb.setArtifact('workspacePath', projectRoot)

  const toolSaveRes = await memoryTool.execute(
    JSON.stringify({
      action: 'save',
      content: 'Используем Vite 5 для сборки бандла',
      category: 'project_fact',
      subject: `test_bundler_${Date.now()}`,
      importance: 4
    }),
    mockBb
  )
  assert.ok(toolSaveRes.formattedContent.includes('Saved to long-term memory'), 'Tool should save fact with subject')
  if (toolSaveRes.data && (toolSaveRes.data as any).id) {
    MemoryService.deleteMemory((toolSaveRes.data as any).id, projectRoot)
  }
  console.log('  ✅ MemoryTool: tool execution with subject parameter verified.\n')

  // Test 6: Blackboard Working Memory Scratchpad
  console.log('▶ Testing Component 6: Blackboard Working Memory Scratchpad...')
  const parentBb = new Blackboard()
  parentBb.setHypothesis('port_3000', 'Port 3000 is open', 'verified', 'netstat showed listening')
  const childBb = parentBb.createChild()
  childBb.setHypothesis('db_ready', 'Database initialized', 'pending')

  const childHypotheses = childBb.getHypotheses()
  assert.strictEqual(childHypotheses.length, 2, 'Child blackboard should inherit parent hypotheses')
  const scratchpadPrompt = childBb.getScratchpadPrompt()
  assert.ok(scratchpadPrompt.includes('Working Memory Scratchpad'), 'Should render Scratchpad header')
  assert.ok(scratchpadPrompt.includes('✅'), 'Should render verified icon')
  console.log('  ✅ Blackboard Scratchpad: operational working memory & child inheritance verified.\n')

  // Test 7: Skill Auto-Enforcement Directive
  console.log('▶ Testing Component 7: Skills Auto-Enforcement Gate...')
  const enforcementTurn1 = await SkillService.getEnforcementDirectiveAsync('создай mcp сервер для базы данных', projectRoot, undefined, 1)
  assert.ok(enforcementTurn1.includes('CRITICAL_SKILL_ENFORCEMENT'), 'Should trigger enforcement directive on Turn 1')
  assert.ok(enforcementTurn1.includes('mcp-builder'), 'Should point to mcp-builder skill')

  const enforcementTurn3 = await SkillService.getEnforcementDirectiveAsync('создай mcp сервер для базы данных', projectRoot, undefined, 3)
  assert.strictEqual(enforcementTurn3, '', 'Should suppress enforcement directive on later turns')
  console.log('  ✅ SkillService: Turn-1 Auto-Enforcement Gate verified.\n')

  // Test 8: MCP Schema Sanitization
  console.log('▶ Testing Component 8: MCP Schema Sanitizer (Gemini OpenAPI compliance)...')
  const rawSchema = {
    type: 'object',
    properties: {
      port: { type: 'number', description: 'Port number', default: 8080 },
      host: { type: 'string', description: 'Host name' }
    },
    required: ['host']
  }
  const cleanSchema = McpService.sanitizeToolSchema(rawSchema)
  assert.strictEqual(cleanSchema.type, 'object')
  assert.ok(!('default' in (cleanSchema.properties?.port || {})), 'Must remove forbidden default property')
  assert.deepStrictEqual(cleanSchema.required, ['host'], 'Must preserve required properties')
  console.log('  ✅ McpService: OpenAPI schema sanitization verified.\n')

  console.log('🎉 ALL 8 VERIFICATION SUITES PASSED CLEANLY!')
}

runTests().catch((err) => {
  console.error('❌ Test failed:', err)
  process.exit(1)
})

