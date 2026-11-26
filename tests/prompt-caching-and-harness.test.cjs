const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const source = path.resolve(file)
  const result = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, source)
  return mod.exports
}

test('resolveSystemRole accurately distinguishes OpenAI developer-role models from others', () => {
  const { resolveSystemRole } = load('src/main/agent/core/SystemPromptPipeline.ts')
  for (const model of ['o1', 'o3', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5-codex', 'codex-mini', 'openai/o3', 'openai/gpt-5']) {
    assert.equal(resolveSystemRole(model), 'developer', model)
  }
  for (const model of ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'o1-preview', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat', '']) {
    assert.equal(resolveSystemRole(model), 'system', model)
  }
})

test('ChatService.sanitizeMessages preserves KV-cache by never hoisting mid-run reminders into messages[0]', () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const sanitized = ChatService.sanitizeMessages([
    { role: 'system', content: 'STATIC_SYS' },
    { role: 'user', name: 'zipply_runtime_context', content: '<runtime_context>date</runtime_context>' },
    { role: 'user', content: 'Check project' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c1', name: 'read_file', content: 'data' },
    { role: 'developer', content: 'Mid-run reminder' }
  ], { model: 'o3' })

  assert.equal(sanitized[0].role, 'developer')
  assert.equal(sanitized[0].content, 'STATIC_SYS')
  assert.equal(sanitized[1].name, undefined)
  assert.equal(sanitized.at(-1).role, 'user')
  assert.match(sanitized.at(-1).content, /<system_reminder>[\s\S]*Mid-run reminder/)
})

test('ChatService adds prompt_cache_key for OpenAI, cache_control for OpenRouter Anthropic, and reads cachedTokens', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const originalFetch = global.fetch
  const payloads = []
  global.fetch = async (url, options) => {
    payloads.push({ url, body: JSON.parse(options.body) })
    return Response.json({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 80 } }
    })
  }
  try {
    const res1 = await ChatService.chat(
      { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4', stream: false },
      [{ role: 'system', content: 'Static prompt' }, { role: 'user', content: 'hi' }]
    )
    assert.equal(res1.usage.cachedTokens, 80)
    assert.deepEqual(payloads[0].body.messages[0].content, [
      { type: 'text', text: 'Static prompt', cache_control: { type: 'ephemeral' } }
    ])

    await ChatService.chat(
      { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5', workspacePath: '/repo', sessionId: 's1', stream: false },
      [{ role: 'developer', content: 'Static prompt' }, { role: 'user', content: 'hi' }]
    )
    assert.equal(typeof payloads[1].body.prompt_cache_key, 'string')
    assert.equal(payloads[1].body.prompt_cache_key.length, 32)
  } finally {
    global.fetch = originalFetch
  }
})

test('AgentRunner keeps messages[0] and tools[] byte-identical across rounds, planMode toggles, task changes, and mid-run reminders', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  const bodies = []
  let round = 0
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    round++
    if (round <= 4) {
      return Response.json({ choices: [{ message: { content: null, tool_calls: [{ id: `c${round}`, type: 'function', function: { name: 'inspect', arguments: '{}' } }] } }] })
    }
    return Response.json({ choices: [{ message: { content: 'done' } }] })
  }
  const inspect = {
    name: 'inspect',
    description: 'Inspect',
    parameters: {},
    validate: () => null,
    getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: false }),
    execute: async () => ({ formattedContent: 'Same unchanged output' })
  }
  const agent = { id: 'zipply', getTools: () => [inspect], getHandler: () => inspect }
  const events = []
  try {
    await AgentRunner.run(agent, [{ role: 'user', content: 'Turn 1' }], { model: 'gpt-5', stream: false, accessMode: 'automatic' }, e => events.push(e))
  } finally {
    global.fetch = originalFetch
  }

  assert.equal(bodies.length, 4) // round 1 baseline, rounds 2-4 repeats -> stop on 3rd repeat
  assert.equal(events.findLast(e => e.type === 'run_summary')?.summary?.reason, 'no_progress')
  assert.equal(bodies[0].messages[0].role, 'developer')
  assert.equal(bodies[0].messages[0].content, bodies[1].messages[0].content)
  assert.equal(bodies[1].messages[0].content, bodies[2].messages[0].content)
  assert.equal(bodies[2].messages[0].content, bodies[3].messages[0].content)
  assert.deepEqual(bodies[0].tools, bodies[1].tools)
  assert.deepEqual(bodies[1].tools, bodies[3].tools)
  // No date or taskState in messages[0]
  assert.doesNotMatch(bodies[0].messages[0].content, /<runtime_context>|<agent_task_state_json>|<planning_mode>/)
  // Mid-run warning arrived in tail as <system_reminder> on round 4, not in messages[0]
  assert.ok(bodies[3].messages.some(m => m.role === 'user' && typeof m.content === 'string' && m.content.includes('<system_reminder>')))

  // Compare messages[0] across planMode=false vs planMode=true and different user goals
  const prefixes = []
  global.fetch = async (_url, options) => {
    prefixes.push(JSON.parse(options.body))
    return Response.json({ choices: [{ message: { content: 'ok' } }] })
  }
  try {
    await AgentRunner.run(agent, [{ role: 'user', content: 'Goal A' }], { model: 'gpt-5', stream: false, planMode: false }, () => {})
    await AgentRunner.run(agent, [{ role: 'user', content: 'Goal B' }], { model: 'gpt-5', stream: false, planMode: true }, () => {})
  } finally {
    global.fetch = originalFetch
  }
  assert.equal(prefixes[0].messages[0].content, prefixes[1].messages[0].content)
  assert.match(JSON.stringify(prefixes[1].messages.slice(1)), /<planning_mode>/)
})

test('AgentRunner detects 2-step A->B->A->B oscillation and warns before stopping', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  const bodies = []
  let step = 0
  const sequence = ['tool_a', 'tool_b', 'tool_a', 'tool_b', 'tool_a', 'tool_b']
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    const name = sequence[step++]
    return Response.json({
      choices: [{ message: name ? { content: null, tool_calls: [{ id: `s${step}`, type: 'function', function: { name, arguments: '{}' } }] } : { content: 'done' } }]
    })
  }
  const makeTool = (name) => ({
    name, description: name, parameters: {}, validate: () => null,
    getExecutionPolicy: () => ({ mutates: false, parallelSafe: false, cacheable: false }),
    execute: async () => ({ formattedContent: `${name} result` })
  })
  const tools = [makeTool('tool_a'), makeTool('tool_b')]
  const events = []
  try {
    await AgentRunner.run(
      { id: 'zipply', getTools: () => tools, getHandler: n => tools.find(t => t.name === n) },
      [{ role: 'user', content: 'Run' }],
      { model: 'test', stream: false },
      e => events.push(e)
    )
  } finally {
    global.fetch = originalFetch
  }
  const summary = events.findLast(e => e.type === 'run_summary')?.summary
  assert.equal(summary.reason, 'no_progress')
  assert.ok(bodies.some(b => JSON.stringify(b.messages).includes('циклическое чередование')))
  assert.equal(bodies[0].messages[0].content, bodies.at(-1).messages[0].content)
})

test('ProjectRulesLoader loads hierarchically from git root, respects AGENTS.override.md, 32 KiB limit, and lazy subdirs', async () => {
  const { ProjectRulesLoader, MAX_PROJECT_RULES_BYTES } = load('src/main/agent/core/ProjectRulesLoader.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-rules-hier-'))
  try {
    await fs.mkdir(path.join(root, '.git'))
    const workspace = path.join(root, 'packages', 'app')
    const nested = path.join(workspace, 'src', 'feature')
    await fs.mkdir(nested, { recursive: true })
    await fs.writeFile(path.join(root, 'AGENTS.md'), 'ROOT_RULE')
    await fs.writeFile(path.join(workspace, 'AGENTS.md'), 'IGNORED_BY_OVERRIDE')
    await fs.writeFile(path.join(workspace, 'AGENTS.override.md'), 'APP_OVERRIDE_RULE')
    await fs.writeFile(path.join(nested, 'AGENTS.md'), 'NESTED_FEATURE_RULE')

    const board = new Blackboard()
    const session = await ProjectRulesLoader.loadInitial(workspace, board, {
      confirmAction: async () => true
    })
    assert.match(session.initialPrompt, /ROOT_RULE/)
    assert.match(session.initialPrompt, /APP_OVERRIDE_RULE/)
    assert.doesNotMatch(session.initialPrompt, /IGNORED_BY_OVERRIDE/)
    assert.doesNotMatch(session.initialPrompt, /NESTED_FEATURE_RULE/)

    // Enforce 32 KiB cap
    const hugeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-rules-cap-'))
    try {
      await fs.writeFile(path.join(hugeDir, 'AGENTS.md'), 'A'.repeat(40000))
      const capped = await ProjectRulesLoader.loadInitial(hugeDir, new Blackboard(), {})
      assert.ok(Buffer.byteLength(capped.initialPrompt, 'utf8') <= MAX_PROJECT_RULES_BYTES)
      assert.match(capped.initialPrompt, /усечено по лимиту 32 KiB/)
    } finally {
      await fs.rm(hugeDir, { recursive: true, force: true })
    }

    // Lazy subdir injection in AgentRunner without mutating messages[0]
    const originalFetch = global.fetch
    const bodies = []
    let call = 0
    global.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body))
      call++
      if (call === 1) {
        return Response.json({
          choices: [{ message: { content: null, tool_calls: [{ id: 'r1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'src/feature/index.ts' }) } }] } }]
        })
      }
      return Response.json({ choices: [{ message: { content: 'Done' } }] })
    }
    const readTool = {
      name: 'read_file', description: 'read', parameters: {}, validate: () => null,
      getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: false }),
      execute: async () => ({ formattedContent: 'export const x = 1' })
    }
    try {
      await AgentRunner.run(
        { id: 'zipply', getTools: () => [readTool], getHandler: () => readTool },
        [{ role: 'user', content: 'Read feature file' }],
        { model: 'test', stream: false, workspacePath: workspace, confirmAction: async () => true },
        () => {}
      )
    } finally {
      global.fetch = originalFetch
    }
    assert.equal(bodies.length, 2)
    assert.equal(bodies[0].messages[0].content, bodies[1].messages[0].content)
    assert.doesNotMatch(bodies[0].messages[0].content, /NESTED_FEATURE_RULE/)
    assert.match(JSON.stringify(bodies[1].messages.slice(1)), /NESTED_FEATURE_RULE/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('runAgent includes <available_plugins> in messages[0] and keeps base tools sorted ahead of newly loaded plugin tools', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const { PluginManager } = load('src/main/agent/plugins/PluginManager.ts')
  const dir = await fs.mkdtemp(path.join(path.resolve('scratch'), 'zipply-plugins-prompt-'))
  const manager = new PluginManager(dir)
  const originalFetch = global.fetch
  const bodies = []
  try {
    manager.setInstalled('cybersec', true)
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body)
      bodies.push(body)
      if (bodies.length === 1) {
        return Response.json({
          choices: [{ message: { content: null, tool_calls: [{ id: 'p1', type: 'function', function: { name: 'plugin_manager', arguments: JSON.stringify({ action: 'load', pluginId: 'cybersec', toolId: 'cybersec_audit_project' }) } }] } }]
        })
      }
      return Response.json({ choices: [{ message: { content: 'Ready' } }] })
    }
    await runAgent(
      'zipply',
      [{ role: 'user', content: 'List plugins and load audit' }],
      { model: 'test', stream: false, workspacePath: dir },
      () => {},
      undefined,
      ['cybersec'],
      { sessionId: 's-plug', manager }
    )
    assert.equal(bodies.length, 2)
    assert.match(bodies[0].messages[0].content, /<available_plugins>/)
    assert.match(bodies[0].messages[0].content, /cybersec/)
    assert.equal(bodies[0].messages[0].content, bodies[1].messages[0].content)
    const firstNames = bodies[0].tools.map(t => t.function.name)
    const secondNames = bodies[1].tools.map(t => t.function.name)
    assert.deepEqual(secondNames.slice(0, firstNames.length), firstNames)
    assert.equal(secondNames.at(-1), 'cybersec_audit_project')
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('nested AGENTS.md is loaded before write_file, text apply_patch, JSON apply_patch, and extensionless files without writing first', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const originalFetch = global.fetch

  // 1. write_file targeting an extensionless file in a subdirectory with AGENTS.md
  const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-pre-rules-write-'))
  const sub1 = path.join(dir1, 'packages', 'sub')
  await fs.mkdir(sub1, { recursive: true })
  await fs.writeFile(path.join(sub1, 'AGENTS.md'), 'SUB_RULE_HEADER=STRICT')
  let sawFileDuringRequest2 = false
  const bodies1 = []
  let req1 = 0
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies1.push(body)
    req1++
    if (req1 === 1) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'w1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'packages/sub/Makefile', content: 'DRAFT=1\n' }) } }] } }]
      })
    }
    if (req1 === 2) {
      sawFileDuringRequest2 = await fs.access(path.join(sub1, 'Makefile')).then(() => true, () => false)
      assert.match(JSON.stringify(body.messages.slice(1)), /SUB_RULE_HEADER=STRICT/)
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'w2', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'packages/sub/Makefile', content: 'STRICT=1\n' }) } }] } }]
      })
    }
    if (req1 === 3) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'v1', type: 'function', function: { name: 'verify_file', arguments: JSON.stringify({ path: 'packages/sub/Makefile', predicate: 'equals', expected: 'STRICT=1\n' }) } }] } }]
      })
    }
    return Response.json({ choices: [{ message: { content: 'Done.' } }] })
  }
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Create Makefile in sub' }], { model: 'test', stream: false, workspacePath: dir1, accessMode: 'automatic' }, () => {})
    assert.equal(sawFileDuringRequest2, false, 'write_file must NOT write to disk before nested AGENTS.md arrives')
    assert.equal(bodies1.length, 4)
    assert.equal(bodies1[0].messages[0].content, bodies1[1].messages[0].content)
    assert.equal(await fs.readFile(path.join(sub1, 'Makefile'), 'utf8'), 'STRICT=1\n')
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir1, { recursive: true, force: true })
  }

  // 2. Text apply_patch AND JSON apply_patch across multiple subdirectories + malformed patch fallback
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-pre-rules-patch-'))
  const subA = path.join(dir2, 'modA')
  const subB = path.join(dir2, 'modB')
  await fs.mkdir(subA, { recursive: true })
  await fs.mkdir(subB, { recursive: true })
  await fs.writeFile(path.join(subA, 'AGENTS.md'), 'MOD_A_RULE_USE_CONST')
  await fs.writeFile(path.join(subB, 'AGENTS.md'), 'MOD_B_RULE_NO_VAR')
  let patchWrittenBeforeRules = false
  let req2 = 0
  const bodies2 = []
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies2.push(body)
    req2++
    if (req2 === 1) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'p_text',
              type: 'function',
              function: {
                name: 'apply_patch',
                arguments: JSON.stringify({
                  patch: '*** Begin Patch\n*** Add File: modA/a.ts\n+var a = 1\n*** Add File: modB/b.ts\n+var b = 2\n*** End Patch'
                })
              }
            }]
          }
        }]
      })
    }
    if (req2 === 2) {
      patchWrittenBeforeRules = await fs.access(path.join(subA, 'a.ts')).then(() => true, () => false)
      assert.match(JSON.stringify(body.messages.slice(1)), /MOD_A_RULE_USE_CONST/)
      assert.match(JSON.stringify(body.messages.slice(1)), /MOD_B_RULE_NO_VAR/)
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'p_json',
              type: 'function',
              function: {
                name: 'apply_patch',
                arguments: JSON.stringify({
                  operations: [
                    { path: 'modA/a.ts', action: 'create', content: 'export const a = 1\n' },
                    { path: 'modB/b.ts', action: 'create', content: 'export const b = 2\n' }
                  ]
                })
              }
            }]
          }
        }]
      })
    }
    if (req2 === 3) {
      // Malformed patch should not crash pre-loader and should return normal validation error
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{ id: 'p_bad', type: 'function', function: { name: 'apply_patch', arguments: JSON.stringify({ patch: 'bad patch' }) } }]
          }
        }]
      })
    }
    return Response.json({ choices: [{ message: { content: 'Patched cleanly.' } }] })
  }
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Patch modA and modB' }], { model: 'test', stream: false, workspacePath: dir2, accessMode: 'automatic' }, () => {})
    assert.equal(patchWrittenBeforeRules, false, 'text apply_patch must NOT write before nested AGENTS.md arrives')
    assert.equal(req2, 5) // 1 deferred + 1 JSON patch + 1 malformed patch + 1 premature final + 1 recovery
    assert.equal(await fs.readFile(path.join(subA, 'a.ts'), 'utf8'), 'export const a = 1\n')
    assert.equal(await fs.readFile(path.join(subB, 'b.ts'), 'utf8'), 'export const b = 2\n')
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir2, { recursive: true, force: true })
  }
})
