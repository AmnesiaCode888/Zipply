const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('Blackboard stores typed task state and child boards inherit it', () => {
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const state = {
    goal: 'Implement task state',
    constraints: ['Do not change event APIs'],
    acceptanceCriteria: ['Compaction preserves the original goal'],
    confirmedFacts: ['Blackboard supports child instances'],
    nextStep: 'Add compaction coverage'
  }
  const parent = new Blackboard()
  parent.setTaskState(state)
  const child = parent.createChild()
  assert.deepEqual(child.getTaskState(), state)
  assert.match(child.getTaskStatePrompt(), /Implement task state/)
  assert.match(child.getTaskStatePrompt(), /Compaction preserves the original goal/)
  assert.doesNotMatch(child.getTaskStatePrompt(), /Обновляй понимание/)
})

test('compaction preserves one deterministic task-state record across repeated compaction', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const state = {
    goal: 'Create target.txt and verify its contents',
    constraints: ['Use the current workspace'],
    acceptanceCriteria: ['target.txt contains READY'],
    confirmedFacts: ['The workspace is writable'],
    nextStep: 'Write the file, then read it back'
  }
  const history = [
    { role: 'system', content: 'Agent rules' },
    { role: 'user', content: 'Earlier context. '.repeat(1400) },
    { role: 'assistant', content: 'Completed earlier investigation.' },
    { role: 'user', content: 'Continue with the task.' }
  ]
  const options = { contextLength: 1800, maxTokens: 256, summaryInputBudgetTokens: 12000, taskState: state, summarize: async () => 'Older investigation found no artifact.' }
  const first = await ContextCompactor.compactAsync(history, options)
  const second = await ContextCompactor.compactAsync(first, options)
  const systemPrompt = second.filter(message => message.role === 'system' || message.role === 'developer').map(message => message.content).join('\n')
  assert.equal(systemPrompt, 'Agent rules')
  const serialized = second.map(message => typeof message.content === 'string' ? message.content : '').join('\n')
  const records = serialized.match(/<agent_task_state_json>[\s\S]*?<\/agent_task_state_json>/g) || []
  assert.equal(records.length, 1)
  assert.deepEqual(JSON.parse(records[0].replace(/<\/?agent_task_state_json>/g, '').trim()), state)
  assert.match(JSON.stringify(second), /Create target\.txt and verify its contents/)
  assert.equal(second.at(-1).content, 'Continue with the task.')
})

test('AgentRunner lets the latest user goal replace a stale supplied task state', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  const bodies = []
  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body))
    const message = bodies.length === 1
      ? { content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'inspect', arguments: '{}' } }] }
      : { content: 'Completed the check.' }
    return Response.json({ choices: [{ message }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } })
  }
  const tool = { name: 'inspect', description: 'Inspect state', parameters: {}, validate: () => null, getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: false }), execute: async () => ({ formattedContent: 'Inspection returned a confirmed fact.' }) }
  const agent = { id: 'zipply', getTools: () => [tool], getHandler: name => name === 'inspect' ? tool : undefined }
  const state = { goal: 'Explicit goal', constraints: ['Keep file format'], acceptanceCriteria: ['File parses'], confirmedFacts: ['Project uses JSON'], nextStep: 'Edit and parse' }
  const events = []
  try {
    await AgentRunner.run(agent, [{ role: 'user', content: 'Earlier request' }, { role: 'user', content: 'Latest user goal' }], { model: 'test', stream: false, taskState: state }, event => events.push(event))
  } finally {
    global.fetch = originalFetch
  }
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0].messages[0].content, bodies[1].messages[0].content)
  for (const body of bodies) {
    const taskContext = JSON.stringify(body.messages)
    assert.match(taskContext, /Latest user goal/)
    assert.doesNotMatch(taskContext, /Explicit goal/)
    assert.match(taskContext, /File parses/)
    const systemOnly = body.messages.filter(message => message.role === 'system' || message.role === 'developer').map(message => message.content).join('\n')
    assert.equal((systemOnly.match(/<agent_task_state_json>/g) || []).length, 0)
    const allText = body.messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n')
    assert.equal((allText.match(/<agent_task_state_json>/g) || []).length, 1)
  }
  assert.doesNotMatch(JSON.stringify(events), /zipply_task_state_v1|zipply_runtime_context/)
})

test('AgentRunner initializes an explicit state from the latest user turn without inventing criteria', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  let request
  global.fetch = async (_url, options) => {
    request = JSON.parse(options.body)
    return Response.json({ choices: [{ message: { content: 'Done.' } }] })
  }
  try {
    await AgentRunner.run({ id: 'zipply', getTools: () => [], getHandler: () => undefined }, [
      { role: 'user', content: 'Old task' },
      { role: 'user', content: 'Latest user goal' }
    ], { model: 'test', stream: false }, () => {})
  } finally {
    global.fetch = originalFetch
  }
  const system = request.messages.find(message => message.role === 'system')?.content || ''
  const allText = request.messages.map(message => typeof message.content === 'string' ? message.content : '').join('\n')
  const stateBlock = allText.match(/<agent_task_state_json>([\s\S]*?)<\/agent_task_state_json>/)
  const state = JSON.parse(stateBlock[1].trim())
  assert.equal(state.goal, 'Latest user goal')
  assert.deepEqual(state.acceptanceCriteria, [])
  assert.doesNotMatch(system, /Old task/)
  assert.doesNotMatch(system, /Latest user goal/)
  assert.doesNotMatch(system, /<agent_task_state_json>/)
})

test('updating one acceptance criterion increments only that criterion revision and keeps unchanged criteria verified', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const fs = require('node:fs/promises')
  const os = require('node:os')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-crit-rev-'))
  await fs.writeFile(path.join(dir, 'a.txt'), 'ALPHA')
  await fs.writeFile(path.join(dir, 'b.txt'), 'BETA')
  const originalFetch = global.fetch
  let step = 0
  global.fetch = async () => {
    step++
    if (step === 1) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'p1', type: 'function', function: { name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Verify both', status: 'in_progress' }], acceptance_criteria: ['a.txt has ALPHA', 'b.txt has BETA'] }) } }] } }]
      })
    }
    if (step === 2) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [
              { id: 'v1', type: 'function', function: { name: 'verify_file', arguments: JSON.stringify({ criterion_id: 'c_1', path: 'a.txt', predicate: 'equals', expected: 'ALPHA' }) } },
              { id: 'v2', type: 'function', function: { name: 'verify_file', arguments: JSON.stringify({ criterion_id: 'c_2', path: 'b.txt', predicate: 'equals', expected: 'BETA' }) } }
            ]
          }
        }]
      })
    }
    if (step === 3) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'p2', type: 'function', function: { name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Re-verify a.txt', status: 'in_progress' }], acceptance_criteria: ['a.txt has GAMMA', 'b.txt has BETA'] }) } }] } }]
      })
    }
    return Response.json({ choices: [{ message: { content: 'Done.' } }] })
  }
  const events = []
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Verify and update plan' }], { model: 'test', stream: false, workspacePath: dir, accessMode: 'automatic' }, e => events.push(e))
    const summary = events.findLast(e => e.type === 'run_summary')?.summary
    assert.equal(summary.verificationStatus, 'unverified')
    assert.deepEqual(summary.unverifiedCriteria, ['a.txt has GAMMA'])
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})
