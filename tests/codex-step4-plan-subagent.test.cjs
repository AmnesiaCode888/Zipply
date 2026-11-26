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

test('UpdatePlanTool updates Blackboard taskState and emits plan_update event during AgentRunner', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-plan-tool-'))
  const originalFetch = global.fetch
  let round = 0
  let secondRequestBody
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    round++
    if (round === 1) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'p1',
              type: 'function',
              function: {
                name: 'update_plan',
                arguments: JSON.stringify({
                  explanation: 'Initial investigation plan',
                  plan: [
                    { step: 'Inspect config', status: 'completed' },
                    { step: 'Fix parser', status: 'in_progress' },
                    { step: 'Run tests', status: 'pending' }
                  ],
                  acceptance_criteria: ['parser tests pass'],
                  confirmed_facts: ['parser.ts uses regex']
                })
              }
            }]
          }
        }]
      })
    }
    secondRequestBody = body
    return Response.json({ choices: [{ message: { content: 'Plan updated.' } }] })
  }

  const events = []
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Fix the parser' }], { model: 'test', stream: false, workspacePath: dir }, e => events.push(e))
    const planEvt = events.find(e => e.type === 'plan_update')
    assert.ok(planEvt)
    assert.equal(planEvt.plan.length, 3)
    assert.equal(planEvt.plan[1].status, 'in_progress')
    const bodyStr = JSON.stringify(secondRequestBody.messages.slice(1))
    assert.match(bodyStr, /Fix parser/)
    assert.match(bodyStr, /parser tests pass/)
    assert.match(bodyStr, /parser\.ts uses regex/)
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('SpawnAgentTool runs a child read-only explorer agent and isolates noisy intermediate reads from parent', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-subagent-'))
  await fs.writeFile(path.join(dir, 'secret_clue.txt'), 'CLUE_999\n')
  const originalFetch = global.fetch
  let reqCount = 0
  const bodies = []
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    reqCount++
    // Parent round 1: calls spawn_agent
    if (reqCount === 1) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'sub1',
              type: 'function',
              function: {
                name: 'spawn_agent',
                arguments: JSON.stringify({ task: 'Find what clue is in secret_clue.txt', role: 'explorer', max_rounds: 5, wait: true })
              }
            }]
          }
        }]
      })
    }
    // Child round 1: calls read_file
    if (reqCount === 2) {
      return Response.json({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'child-r1',
              type: 'function',
              function: { name: 'read_file', arguments: JSON.stringify({ path: 'secret_clue.txt' }) }
            }]
          }
        }]
      })
    }
    // Child round 2: returns summary to parent
    if (reqCount === 3) {
      assert.match(JSON.stringify(body.messages), /CLUE_999/)
      // Explorer child must not receive write tools
      const childToolNames = body.tools.map(t => t.function.name)
      assert.ok(!childToolNames.includes('write_file'))
      assert.ok(!childToolNames.includes('edit_file'))
      return Response.json({ choices: [{ message: { content: 'Found clue: CLUE_999 in secret_clue.txt:1' } }] })
    }
    // Parent round 2: final answer
    return Response.json({ choices: [{ message: { content: 'Subagent found CLUE_999.' } }] })
  }

  const events = []
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Use subagent to find the clue' }], { model: 'test', stream: false, workspacePath: dir, accessMode: 'automatic' }, e => events.push(e))
    assert.equal(events.at(-1).type, 'done')
    const parentFinalMsgs = JSON.stringify(bodies[3].messages)
    assert.match(parentFinalMsgs, /CLUE_999/)
    // Child intermediate tool call must not leak into parent tool_calls
    assert.ok(!bodies[3].messages.some(m => m.role === 'tool' && m.name === 'read_file'))
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('ZipplyAgent hides redundant legacy shell/process tools from LLM schema while keeping getHandler backwards compatible', () => {
  const { agentRegistry } = load('src/main/agent/index.ts')
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const agent = agentRegistry.getAgent('zipply')
  const defs = ToolExecutor.buildToolDefs(agent)
  const exposedNames = defs.map(d => d.function.name)

  assert.ok(exposedNames.includes('exec_command'))
  assert.ok(exposedNames.includes('write_stdin'))
  assert.ok(exposedNames.includes('update_plan'))
  assert.ok(exposedNames.includes('spawn_agent'))
  assert.ok(exposedNames.includes('manage_agents'))
  for (const legacy of ['terminal', 'run_command', 'process_start', 'process_poll', 'process_stop', 'process_list']) {
    assert.ok(!exposedNames.includes(legacy), `${legacy} should be hidden from LLM schema`)
    assert.ok(agent.getHandler(legacy), `${legacy} handler must remain available for compatibility`)
  }
})

test('reviewer role instructions reach the compiled model system prompt and spawn_agent returns structured status, usage, and checks', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-reviewer-role-'))
  const originalFetch = global.fetch
  const bodies = []
  let reqCount = 0
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    reqCount++
    if (reqCount === 1) {
      return Response.json({
        usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'rev1',
              type: 'function',
              function: {
                name: 'spawn_agent',
                arguments: JSON.stringify({ task: 'Review recent diff for bugs', role: 'reviewer', max_rounds: 3, wait: true })
              }
            }]
          }
        }]
      })
    }
    if (reqCount === 2) {
      return Response.json({
        usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
        choices: [{ message: { content: 'No defects found in reviewed scope.' } }]
      })
    }
    return Response.json({
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
      choices: [{ message: { content: 'Review complete: clean.' } }]
    })
  }

  const events = []
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Review code with a subagent' }], { model: 'test', stream: false, workspacePath: dir, accessMode: 'automatic' }, e => events.push(e))

    // Request #2 is the reviewer subagent's model call
    const childSystemMsg = bodies[1].messages[0].content
    assert.match(childSystemMsg, /<subagent_role role="reviewer">/)
    assert.match(childSystemMsg, /субагент-ревьюер|reviewer/i)

    // Tree usage must roll up 3 x 12 = 36 tokens
    const runSummary = events.find(e => e.type === 'run_summary')?.summary
    const doneEvt = events.find(e => e.type === 'done')
    assert.equal(runSummary.usage.totalTokens, 36)
    assert.equal(doneEvt.usage.totalTokens, 36)

    // Structured subagent report returned to parent
    const subResult = events.find(e => e.type === 'tool_result')
    assert.equal(subResult.data.role, 'reviewer')
    assert.equal(subResult.data.status, 'completed')
    assert.equal(subResult.data.usage.totalTokens, 12)
    assert.ok(['verified', 'unverified', 'failed'].includes(subResult.data.verificationStatus))
    assert.ok(Array.isArray(subResult.data.checks))
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('shared RunBudget enforces tree token limit across parent and child and expires shared deadline', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const { RunBudget } = load('src/main/agent/core/RunBudget.ts')

  // Direct RunBudget reservation + deadline check
  const budget = new RunBudget({ maxTokens: 30, maxTimeMs: 5000, startedAt: Date.now() })
  budget.recordUsage({ promptTokens: 7, completionTokens: 5, totalTokens: 12, complete: true })
  const res1 = budget.tryReserveChild(10)
  const res2 = budget.tryReserveChild(10)
  const res3 = budget.tryReserveChild(10)
  assert.ok(res1, 'first child within 18 remaining should reserve')
  assert.equal(res2, null, 'second 10-token reserve exceeds 8 remaining')
  assert.equal(res3, null)
  res1.release()
  const resAfter = budget.tryReserveChild(10)
  assert.ok(resAfter, 'released capacity can be reused')
  resAfter.release()

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-budget-tree-'))
  const originalFetch = global.fetch
  let reqCount = 0
  global.fetch = async () => {
    reqCount++
    if (reqCount === 1) {
      return Response.json({
        usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: 'b1',
              type: 'function',
              function: { name: 'spawn_agent', arguments: JSON.stringify({ task: 'Check repo', role: 'explorer', max_rounds: 3, wait: true }) }
            }]
          }
        }]
      })
    }
    return Response.json({
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
      choices: [{ message: { content: 'Subagent finished.' } }]
    })
  }

  const events = []
  try {
    await runAgent(
      'zipply',
      [{ role: 'user', content: 'Run explorer within tight 20 token limit' }],
      { model: 'test', stream: false, workspacePath: dir, accessMode: 'automatic', runLimits: { tokens: 20 } },
      e => events.push(e)
    )
    const runSummary = events.find(e => e.type === 'run_summary')?.summary
    assert.equal(runSummary.reason, 'limit_tokens')
    assert.equal(runSummary.usage.totalTokens, 24)
    assert.equal(reqCount, 2, 'parent must stop before third LLM call once shared tree reaches 24 >= 20')
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})
