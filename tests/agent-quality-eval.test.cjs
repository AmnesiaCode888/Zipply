// Deterministic, local harness-quality scenarios. These are baseline probes,
// not model-quality claims: the provider is scripted and every outcome has an
// explicit filesystem/tool-state oracle. Request characters are a token-cost
// proxy; latency is wall-clock time for this local mocked run only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

function tool(name, execute) {
  return {
    name, description: `evaluation ${name}`, parameters: {},
    validate: () => null,
    getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: false }),
    execute
  }
}

function reply(content, toolCall) {
  const message = toolCall
    ? { content: null, tool_calls: [{ id: `eval-${toolCall.name}-${toolCall.n || 1}`, type: 'function', function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args || {}) } }] }
    : { content }
  return Response.json({ choices: [{ message }], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } })
}

async function runAgent({ tools, script, history, config = {} }) {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const originalFetch = global.fetch
  const requests = []
  const events = []
  let cursor = 0
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push({ chars: JSON.stringify(body).length, messages: body.messages })
    const answer = script({ body, request: requests.length, cursor: cursor++ })
    return answer
  }
  const agent = {
    id: 'zipply-eval',
    getTools: () => tools,
    getHandler: name => tools.find(item => item.name === name)
  }
  const started = performance.now()
  try {
    await AgentRunner.run(agent, history || [{ role: 'user', content: 'Complete the task and verify it.' }], { model: 'deterministic-eval', stream: false, ...config }, event => events.push(event))
  } finally {
    global.fetch = originalFetch
  }
  const done = events.findLast(event => event.type === 'done')
  const summary = events.findLast(event => event.type === 'run_summary')?.summary
  const final = events.findLast(event => event.type === 'history')?.messages?.findLast(message => message.role === 'assistant' && typeof message.content === 'string')?.content || ''
  return {
    events, final, done, summary, requests: requests.length,
    requestChars: requests.reduce((total, item) => total + item.chars, 0),
    toolResults: events.filter(event => event.type === 'tool_result'),
    elapsedMs: Math.round(performance.now() - started)
  }
}

function report(name, run, oracle) {
  const row = {
    scenario: name,
    completion: run.done ? 'done' : run.summary?.reason || 'error-or-stopped',
    falseReady: oracle.falseReady,
    repeatedNoProgress: oracle.repeatedNoProgress || 0,
    toolErrors: run.toolResults.filter(result => result.error).length,
    providerRequests: run.requests,
    requestCharactersProxy: run.requestChars,
    reportedTokens: (run.done?.usage || run.summary?.usage)?.complete ? (run.done?.usage || run.summary?.usage).totalTokens : null,
    ...(oracle.baselineReference ? { baselineReference: oracle.baselineReference } : {}),
    elapsedMsLocalMock: run.elapsedMs
  }
  console.log(`AGENT_QUALITY_BASELINE ${JSON.stringify(row)}`)
}

test('baseline: a long run remains uncapped beyond 50 tool rounds', async () => {
  let executions = 0
  const lookup = tool('lookup', async () => { executions++; return { formattedContent: `step ${executions}` } })
  const run = await runAgent({
    tools: [lookup],
    script: ({ request }) => request <= 53 ? reply('', { name: 'lookup', n: request }) : reply('Finished all requested steps.')
  })
  assert.ok(run.done)
  assert.equal(executions, 53)
  assert.match(run.final, /Finished/)
  report('over-50-steps', run, { falseReady: false })
})

test('baseline: after a failed check the next model step receives the error and can recover', async () => {
  let checks = 0
  let artifact = ''
  const verify = tool('verify', async () => {
    checks++
    return artifact === 'expected output'
      ? { formattedContent: 'CHECK PASSED: output.txt exists and matches expected content' }
      : { formattedContent: 'CHECK FAILED: expected output.txt was missing', error: true }
  })
  const repair = tool('repair', async () => {
    artifact = 'expected output'
    return { formattedContent: 'Created output.txt with expected output.' }
  })
  const run = await runAgent({
    tools: [verify, repair],
    script: ({ request, body }) => {
      if (request === 1) return reply('', { name: 'verify', n: 1 })
      if (request === 2) {
        assert.equal(body.messages.at(-1).role, 'tool')
        assert.match(body.messages.at(-1).content, /CHECK FAILED/)
        return reply('', { name: 'repair', n: 2 })
      }
      if (request === 3) {
        assert.equal(body.messages.at(-1).role, 'tool')
        assert.match(body.messages.at(-1).content, /Created output/)
        return reply('', { name: 'verify', n: 3 })
      }
      assert.match(body.messages.at(-1).content, /CHECK PASSED/)
      return reply('The output was corrected and the check passed.')
    },
    config: { accessMode: 'automatic' }
  })
  assert.equal(run.requests, 4)
  assert.equal(artifact, 'expected output')
  assert.ok(run.done)
  assert.equal(run.toolResults.filter(result => result.error).length, 1)
  assert.equal(checks, 2)
  assert.match(run.final, /check passed/i)
  report('failed-check-recovery', run, { falseReady: false })
})

test('regression: repeated successful calls without progress trigger strategy change and stop', async () => {
  let projectChanges = 0
  const inspect = tool('inspect', async () => ({ formattedContent: 'No output file exists; project state unchanged.' }))
  const run = await runAgent({
    tools: [inspect],
    script: ({ request }) => request <= 4 ? reply('', { name: 'inspect', n: request }) : reply('Done; the requested output is ready.')
  })
  const oracleFalseReady = projectChanges === 0 && /output is ready/i.test(run.final)
  assert.equal(run.summary?.reason, 'no_progress')
  assert.equal(run.toolResults.length, 4)
  assert.equal(projectChanges, 0)
  assert.equal(oracleFalseReady, false)
  assert.ok(run.events.some(event => event.type === 'error' && /остановлен/i.test(event.message) && /стратеги/i.test(event.message)))
  report('successful-no-progress-repeat', run, {
    falseReady: oracleFalseReady,
    repeatedNoProgress: 3,
    baselineReference: { falseReady: true, repeatedNoProgress: 4 }
  })
})

test('baseline: compaction on a long history sends a summary and preserves the current user turn', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const longHistory = [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'Original goal: create artifact named target.txt. Keep this goal.' },
    { role: 'assistant', content: 'Earlier work. '.repeat(1800) },
    { role: 'user', content: 'Continue and verify target.txt.' }
  ]
  let summarizeCalls = 0
  const compacted = await ContextCompactor.compactAsync(longHistory, {
    contextLength: 1800,
    maxTokens: 256,
    toolSchemaTokens: 0,
    summaryInputBudgetTokens: 12000,
    summarize: async messages => {
      summarizeCalls++
      assert.ok(messages.some(message => /Original goal/.test(message.content || '')))
      return 'Preserve goal: create artifact named target.txt.'
    }
  })
  assert.equal(summarizeCalls, 1)
  assert.equal(compacted.at(-1).content, 'Continue and verify target.txt.')
  assert.match(JSON.stringify(compacted), /target\.txt/)
  const compactedChars = JSON.stringify(compacted).length
  console.log(`AGENT_QUALITY_BASELINE ${JSON.stringify({ scenario: 'long-history-compaction', completion: 'compacted', falseReady: false, summaryCalls: summarizeCalls, inputChars: JSON.stringify(longHistory).length, compactedChars })}`)
})

test('baseline: exit-zero command can report success while the expected artifact is absent', async () => {
  const { TerminalTool } = load('src/main/agent/tools/TerminalTool.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-agent-quality-'))
  try {
    const board = new Blackboard()
    board.setArtifact('config', { workspacePath: root })
    const command = process.platform === 'win32' ? 'Write-Output "command completed"' : 'printf "command completed\\n"'
    const result = await new TerminalTool().execute(JSON.stringify({ command }), board)
    const artifactExists = await fs.access(path.join(root, 'expected.txt')).then(() => true, () => false)
    const oracleFalseReady = result.success === true && !artifactExists
    assert.equal(result.success, true)
    assert.equal(artifactExists, false)
    assert.equal(oracleFalseReady, true)
    console.log(`AGENT_QUALITY_BASELINE ${JSON.stringify({ scenario: 'exit-zero-missing-artifact', completion: 'command-success', exitCode: result.data?.exitCode, commandSuccessWithoutArtifact: oracleFalseReady, expectedArtifactExists: artifactExists, baselineReference: { exitCode: 0, expectedArtifactExists: false } })}`)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('regression: read_file(ORCHID) -> write_file(GONE) -> final cannot finish as verified and gets one recovery attempt', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-orchid-gone-'))
  await fs.writeFile(path.join(dir, 'target.txt'), 'ORCHID\n')
  const originalFetch = global.fetch
  let req = 0
  const bodies = []
  global.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body))
    req++
    if (req === 1) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'p1', type: 'function', function: { name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Keep ORCHID', status: 'in_progress' }], acceptance_criteria: ['target.txt contains ORCHID'] }) } }] } }]
      })
    }
    if (req === 2) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'r1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'target.txt' }) } }] } }]
      })
    }
    if (req === 3) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'w1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'target.txt', content: 'GONE\n' }) } }] } }]
      })
    }
    return Response.json({ choices: [{ message: { content: 'Done, target.txt contains ORCHID.' } }] })
  }

  const events = []
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Ensure target.txt contains ORCHID' }], { model: 'test', stream: false, workspacePath: dir, accessMode: 'automatic' }, e => events.push(e))
    const summary = events.findLast(e => e.type === 'run_summary')?.summary
    assert.ok(summary)
    assert.notEqual(summary.verificationStatus, 'verified')
    assert.deepEqual(summary.unverifiedCriteria, ['target.txt contains ORCHID'])
    assert.equal(req, 5) // 3 tool rounds + 1 premature final + 1 recovery attempt
    assert.match(JSON.stringify(bodies[4].messages.slice(1)), /c_1/)
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('regression: verify_file(ORCHID) -> manual disk write(GONE) -> final detects stale snapshot, while clean file ends verified', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const originalFetch = global.fetch

  // A. Manual disk edit after verify_file invalidates verification
  const dir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-verify-stale-'))
  await fs.writeFile(path.join(dir1, 'target.txt'), 'ORCHID\n')
  let step = 0
  global.fetch = async () => {
    step++
    if (step === 1) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'p1', type: 'function', function: { name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Verify target.txt', status: 'in_progress' }], acceptance_criteria: ['target.txt contains ORCHID'] }) } }] } }]
      })
    }
    if (step === 2) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'v1', type: 'function', function: { name: 'verify_file', arguments: JSON.stringify({ criterion_id: 'c_1', path: 'target.txt', predicate: 'contains', expected: 'ORCHID' }) } }] } }]
      })
    }
    if (step === 3) {
      await fs.writeFile(path.join(dir1, 'target.txt'), 'GONE\n')
      return Response.json({ choices: [{ message: { content: 'Verified ORCHID.' } }] })
    }
    return Response.json({ choices: [{ message: { content: 'Still done.' } }] })
  }
  const events1 = []
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Verify ORCHID' }], { model: 'test', stream: false, workspacePath: dir1, accessMode: 'automatic' }, e => events1.push(e))
    const verifyToolResult = events1.find(e => e.type === 'tool_result' && e.data?.predicate === 'contains')
    assert.equal(verifyToolResult?.data?.passed, true)
    const summary1 = events1.findLast(e => e.type === 'run_summary')?.summary
    assert.notEqual(summary1.verificationStatus, 'verified')
    assert.equal(summary1.checks.some(c => c.stale === true), true)
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir1, { recursive: true, force: true })
  }

  // B. Control run with unchanged file ends verified
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-verify-ok-'))
  await fs.writeFile(path.join(dir2, 'target.txt'), 'ORCHID\n')
  let step2 = 0
  global.fetch = async () => {
    step2++
    if (step2 === 1) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'p1', type: 'function', function: { name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'Verify', status: 'completed' }], acceptance_criteria: ['target.txt contains ORCHID'] }) } }] } }]
      })
    }
    if (step2 === 2) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'v1', type: 'function', function: { name: 'verify_file', arguments: JSON.stringify({ criterion_id: 'c_1', path: 'target.txt', predicate: 'contains', expected: 'ORCHID' }) } }] } }]
      })
    }
    return Response.json({ choices: [{ message: { content: 'Verified ORCHID.' } }] })
  }
  const events2 = []
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Verify ORCHID' }], { model: 'test', stream: false, workspacePath: dir2, accessMode: 'automatic' }, e => events2.push(e))
    const summary2 = events2.findLast(e => e.type === 'run_summary')?.summary
    assert.equal(summary2.verificationStatus, 'verified')
    assert.deepEqual(summary2.unverifiedCriteria, [])
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir2, { recursive: true, force: true })
  }
})

test('regression: failed verify_file and exhausted budget end with failed verification status', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-verify-fail-'))
  const originalFetch = global.fetch
  let step = 0
  global.fetch = async () => {
    step++
    if (step === 1) {
      return Response.json({
        choices: [{ message: { content: null, tool_calls: [{ id: 'v1', type: 'function', function: { name: 'verify_file', arguments: JSON.stringify({ path: 'expected.txt', predicate: 'exists' }) } }] } }]
      })
    }
    return Response.json({ choices: [{ message: { content: 'Missing expected.txt.' } }] })
  }
  const events = []
  try {
    await runAgent('zipply', [{ role: 'user', content: 'Check expected.txt' }], { model: 'test', stream: false, workspacePath: dir, accessMode: 'automatic', runLimits: { rounds: 2 }, taskState: { goal: 'Check', constraints: [], acceptanceCriteria: ['expected.txt exists'], confirmedFacts: [], nextStep: '' } }, e => events.push(e))
    const summary = events.findLast(e => e.type === 'run_summary')?.summary
    assert.equal(summary.verificationStatus, 'failed')
    assert.equal(step, 2)
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})
