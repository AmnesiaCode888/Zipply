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

const tool = (name, execute, mutates = false) => ({
  name, description: name, parameters: {}, validate: () => null,
  getExecutionPolicy: () => ({ mutates, cacheable: false, parallelSafe: false }),
  execute
})
const call = (name, args = {}) => ({ id: `id-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } })

async function run(script, tools, config = {}, history = [{ role: 'user', content: 'Perform the task.' }]) {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const original = global.fetch
  const events = []
  const bodies = []
  let request = 0
  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body)
    bodies.push(body)
    return script({ request: ++request, body })
  }
  try {
    await AgentRunner.run({ id: 'zipply', getTools: () => tools, getHandler: name => tools.find(item => item.name === name) }, history, { model: 'test', stream: false, ...config }, event => events.push(event))
  } finally { global.fetch = original }
  return { events, bodies, requests: request, summary: events.findLast(event => event.type === 'run_summary')?.summary }
}
const response = (message, total = 10) => Response.json({ choices: [{ message }], usage: { prompt_tokens: total - 2, completion_tokens: 2, total_tokens: total } })

test('an implementation request gets a recovery round and a pending outcome when no work was performed', async () => {
  const write = tool('write_file', async () => assert.fail('unexpected write'), true)
  const request = 'Fix the retry behavior in this project.'
  const result = await run(() => response({ content: 'Fixed and verified.' }), [write], {}, [{ role: 'user', content: request }])
  assert.equal(result.requests, 2)
  assert.equal(result.summary.taskOutcome, 'unverified')
  assert.match(JSON.stringify(result.bodies[1]), /изменени|правк/)
  assert.match(result.events.findLast(event => event.type === 'history').messages.at(-1).content, /не подтверждена/)

  const question = await run(() => response({ content: 'Here is how retry works.' }), [write], {}, [{ role: 'user', content: 'How do I fix the retry behavior?' }])
  assert.equal(question.requests, 1)
  assert.equal(question.summary.taskOutcome, 'answered')
})

test('printing a test word is not a passing check', async () => {
  const exec = tool('exec_command', async () => ({
    formattedContent: 'test', success: true, data: { exitCode: 0, status: 'exited' }
  }))
  const result = await run(({ request }) => request === 1
    ? response({ tool_calls: [call('exec_command', { command: "node -e \"console.log('test')\"" })] })
    : response({ content: 'Verified.' }), [exec])
  assert.deepEqual(result.summary.checks, [])
  assert.equal(result.summary.verificationStatus, 'unverified')
})

test('a check ID cannot make a different file or assertion satisfy a criterion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-check-scope-'))
  try {
    await fs.writeFile(path.join(root, 'unrelated.txt'), 'READY')
    await fs.writeFile(path.join(root, 'expected.txt'), 'WRONG')
    const { VerifyFileTool } = load('src/main/agent/tools/VerifyFileTool.ts')
    const result = await run(({ request }) => request === 1
      ? response({ tool_calls: [
        { ...call('verify_file', { path: 'unrelated.txt', predicate: 'equals', expected: 'READY', criterion_id: 'c_1' }), id: 'wrong-path' },
        { ...call('verify_file', { path: 'expected.txt', predicate: 'equals', expected: 'WRONG', criterion_id: 'c_1' }), id: 'wrong-value' }
      ] })
      : response({ content: 'Verified.' }), [new VerifyFileTool()], {
        workspacePath: root,
        taskState: { goal: '', constraints: [], acceptanceCriteria: ['expected.txt equals READY'], confirmedFacts: [], nextStep: '' }
      }, [{ role: 'user', content: 'Check the artifact.' }])
    assert.notEqual(result.summary.verificationStatus, 'verified')
    assert.deepEqual(result.summary.unverifiedCriteria, ['expected.txt equals READY'])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a passing shell check is stale after a workspace source changes before finalization', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-check-snapshot-'))
  try {
    const source = path.join(root, 'app.js')
    await fs.writeFile(source, 'module.exports = 42')
    const exec = tool('exec_command', async () => ({
      formattedContent: 'passed', success: true, data: { exitCode: 0, status: 'exited' }
    }))
    const result = await run(async ({ request }) => {
      if (request === 1) return response({ tool_calls: [call('exec_command', { command: 'npm test' })] })
      if (request === 2) await fs.writeFile(source, 'module.exports = 24')
      return response({ content: 'Verified.' })
    }, [exec], {
      workspacePath: root,
      taskState: { goal: '', constraints: [], acceptanceCriteria: ['npm test passes'], confirmedFacts: [], nextStep: '' }
    })
    assert.equal(result.summary.verificationStatus, 'unverified')
    assert.equal(result.summary.checks[0].stale, true)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('two successful shell checks cover separate criteria on the same source version', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-checks-'))
  try {
    await fs.writeFile(path.join(root, 'app.js'), 'module.exports = 42')
    const exec = tool('exec_command', async () => ({
      formattedContent: 'passed', success: true, data: { exitCode: 0, status: 'exited' }
    }), true)
    const result = await run(({ request }) => {
      if (request <= 2) {
        return response({ tool_calls: [call('exec_command', { command: request === 1 ? 'npm test' : 'npm run lint' })] })
      }
      return response({ content: 'Verified.' })
    }, [exec], {
      workspacePath: root,
      taskState: { goal: '', constraints: [], acceptanceCriteria: ['npm test passes', 'npm run lint passes'], confirmedFacts: [], nextStep: '' }
    }, [{ role: 'user', content: 'Run the tests and linter.' }])
    assert.equal(result.summary.verificationStatus, 'verified')
    assert.equal(result.summary.checks.length, 2)
    assert.equal(result.summary.taskOutcome, 'verified')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('command and browser evidence must cover the requested workspace and page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-check-locations-'))
  try {
    await fs.mkdir(path.join(root, 'unrelated'))
    const exec = tool('exec_command', async () => ({
      formattedContent: 'passed', success: true, data: { exitCode: 0, status: 'exited' }
    }))
    const browser = tool('browser_verify', async () => ({
      formattedContent: 'Order paid', success: true, data: { passed: true, url: 'http://localhost:3000/about', criterionId: 'c_2' }
    }))
    const result = await run(({ request }) => request === 1
      ? response({ tool_calls: [
        call('exec_command', { command: 'npm test', cwd: 'unrelated' }),
        call('browser_verify', { url: 'http://localhost:3000/about', assert_text: 'Order paid', criterion_id: 'c_2' })
      ] })
      : response({ content: 'Verified.' }), [exec, browser], {
        workspacePath: root,
        taskState: {
          goal: '', constraints: [], acceptanceCriteria: ['npm test passes', 'http://localhost:3000/checkout shows Order paid'],
          confirmedFacts: [], nextStep: ''
        }
      }, [{ role: 'user', content: 'Verify the tests and checkout page.' }])
    assert.equal(result.summary.verificationStatus, 'unverified')
    assert.deepEqual(result.summary.unverifiedCriteria, ['npm test passes', 'http://localhost:3000/checkout shows Order paid'])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('an identical file write cannot satisfy a task that requires a change', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-noop-'))
  try {
    await fs.writeFile(path.join(root, 'app.js'), 'old')
    const { WriteFileTool } = load('src/main/agent/tools/WriteFileTool.ts')
    const exec = tool('exec_command', async () => ({
      formattedContent: 'passed', success: true, data: { exitCode: 0, status: 'exited' }
    }))
    const result = await run(({ request }) => {
      if (request === 1) return response({ tool_calls: [call('write_file', { path: 'app.js', content: 'old' })] })
      if (request === 2) return response({ tool_calls: [call('exec_command', { command: 'npm test' })] })
      return response({ content: 'Fixed.' })
    }, [new WriteFileTool(), exec], { workspacePath: root }, [{ role: 'user', content: 'Fix app.js.' }])
    assert.equal(result.summary.taskOutcome, 'unverified')
    assert.equal(result.summary.verificationStatus, 'unverified')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('an ordered test in the same tool batch verifies the changed source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-batch-check-'))
  try {
    const { WriteFileTool } = load('src/main/agent/tools/WriteFileTool.ts')
    const exec = tool('exec_command', async () => {
      assert.equal(await fs.readFile(path.join(root, 'app.js'), 'utf8'), 'new')
      return { formattedContent: 'passed', success: true, data: { exitCode: 0, status: 'exited' } }
    })
    const result = await run(({ request }) => request === 1
      ? response({ tool_calls: [
        call('write_file', { path: 'app.js', content: 'new' }),
        call('exec_command', { command: 'npm test' })
      ] })
      : response({ content: 'Fixed.' }), [new WriteFileTool(), exec], { workspacePath: root }, [{ role: 'user', content: 'Fix app.js.' }])
    assert.equal(result.summary.taskOutcome, 'verified')
    assert.equal(result.summary.checks[0].stale, undefined)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('repeated identical successful calls trigger strategy guidance then stop if repetition continues', async () => {
  let executions = 0
  const inspect = tool('inspect', async () => { executions++; return { formattedContent: 'No new information.' } })
  const result = await run(({ request }) => {
    return request <= 6 ? response({ content: null, tool_calls: [call('inspect')] }) : response({ content: 'Finished.' })
  }, [inspect])
  assert.ok(executions < 20)
  assert.ok(result.summary)
  assert.equal(result.summary.reason, 'no_progress')
  assert.ok(result.bodies.some(body => /смените стратегию|сменить стратегию|no-progress/i.test(JSON.stringify(body.messages))))
  assert.equal(result.summary.verificationStatus, 'unverified')
})

test('tool output is retained in the following provider request and run limits are disabled by default', async () => {
  let seen = false
  const lookup = tool('lookup', async () => ({ formattedContent: 'distinctive tool output 123' }))
  const result = await run(({ request, body }) => {
    if (request === 1) return response({ content: null, tool_calls: [call('lookup')] })
    seen = body.messages.at(-1).role === 'tool' && body.messages.at(-1).content.includes('distinctive tool output 123')
    return response({ content: 'Finished.' })
  }, [lookup])
  assert.equal(seen, true)
  assert.equal(result.requests, 2)
  assert.equal(result.summary.reason, 'completed')
  assert.equal(result.summary.rounds, 2)
  assert.equal(result.summary.usage.totalTokens, 20)
  assert.ok(result.summary.elapsedMs >= 0)
})

test('a series of silent tool rounds gets one update and a factual fallback for a blank final answer', async () => {
  const lookup = tool('lookup', async args => JSON.parse(args).index === 3
    ? { error: true, formattedContent: 'Unavailable.' }
    : { formattedContent: 'A result.' })
  const result = await run(({ request }) => request <= 5
    ? response({ tool_calls: [call('lookup', { index: request })] })
    : response({ content: '  ', reasoning_content: 'Thinking.' }), [lookup])

  assert.equal(result.requests, 6)
  const updates = result.events.filter(event => event.type === 'assistant_commentary')
  assert.equal(updates.length, 1)
  assert.match(updates[0].content, /Результатов инструментов: 4, с ошибками: 1/)
  assert.equal(result.events.slice(0, result.events.indexOf(updates[0])).filter(event => event.type === 'tool_result').length, 4)
  const final = result.events.findLast(event => event.type === 'history').messages.at(-1).content
  assert.match(final, /без итогового текста.*Результатов инструментов: 5, с ошибками: 1/)
  assert.ok(result.events.some(event => event.type === 'token' && event.content === final))
  assert.equal(result.summary.taskOutcome, 'unverified')
})

test('a model progress update resets the silent-round count and a text answer is kept', async () => {
  const lookup = tool('lookup', async () => ({ formattedContent: 'A result.' }))
  const result = await run(({ request }) => request <= 5
    ? response({ content: request === 3 ? 'Сверяю данные.' : null, tool_calls: [call('lookup', { index: request })] })
    : response({ content: 'Данные сверены.' }), [lookup])

  assert.deepEqual(result.events.filter(event => event.type === 'assistant_commentary').map(event => event.content), ['Сверяю данные.'])
  assert.equal(result.events.findLast(event => event.type === 'history').messages.at(-1).content, 'Данные сверены.')
})

test('an explicit run limit stops the run with a structured reason', async () => {
  const lookup = tool('lookup', async () => ({ formattedContent: 'one result' }))
  const result = await run(({ request }) => request === 1 ? response({ content: null, tool_calls: [call('lookup')] }) : response({ content: 'Finished.' }), [lookup], { runLimits: { rounds: 1 } })
  assert.ok(result.summary)
  assert.equal(result.summary.reason, 'limit_rounds')
  assert.equal(result.summary.rounds, 1)
  assert.equal(result.requests, 1)
  const detailIndex = result.events.findIndex(event => event.type === 'token' && /Результатов инструментов: 1/.test(event.content))
  assert.ok(detailIndex > result.events.findIndex(event => event.type === 'tool_result'))
  assert.ok(detailIndex < result.events.findIndex(event => event.type === 'error'))
})

test('a passing unrelated check does not verify explicit acceptance criteria', async () => {
  let executions = 0
  const inspect = tool('inspect', async () => ({ formattedContent: `step ${++executions}` }))
  const verify = tool('verify', async () => ({ formattedContent: 'CHECK PASSED', success: true }))
  const result = await run(({ request }) => request <= 52
    ? response({ content: null, tool_calls: [call('inspect', { step: request })] })
    : request === 53
      ? response({ content: null, tool_calls: [call('verify')] })
      : response({ content: 'Finished.' }), [inspect, verify], {
        taskState: { goal: 'Complete a long task', constraints: [], acceptanceCriteria: ['The task check passes'], confirmedFacts: [], nextStep: '' }
      })
  assert.equal(executions, 52)
  assert.equal(result.summary.rounds, 54)
  assert.equal(result.summary.reason, 'completed')
  assert.deepEqual(result.summary.checks.map(check => check.passed), [true])
  assert.equal(result.summary.verificationStatus, 'unverified')
  assert.deepEqual(result.summary.unverifiedCriteria, ['The task check passes'])
  assert.match(JSON.stringify(result.events), /не подтверждена как полностью готовая/)
})

test('a passing command verifies only a criterion it deterministically covers', async () => {
  const terminal = tool('terminal', async () => ({ formattedContent: '$ npm test\nTests passed\n(завершено с кодом 0)', data: { exitCode: 0, command: 'npm test', stdout: 'Tests passed' }, success: true }), true)
  const result = await run(({ request }) => request === 1
    ? response({ content: null, tool_calls: [call('terminal', { command: 'npm test' })] })
    : response({ content: 'The test passes.' }), [terminal], {
      taskState: { goal: 'Run tests', constraints: [], acceptanceCriteria: ['npm test passes'], confirmedFacts: [], nextStep: '' }
    })
  assert.equal(result.summary.verificationStatus, 'verified', JSON.stringify(result.summary))
  assert.deepEqual(result.summary.unverifiedCriteria, [])
})

test('process_start is pending until process_poll reports a terminal exit', async () => {
  const processStart = tool('process_start', async () => ({ success: true, formattedContent: 'Process p1: running', data: { id: 'p1', status: 'running' } }), true)
  const processPoll = tool('process_poll', async () => ({ success: true, formattedContent: 'Process p1: exited, exit code 0', data: { id: 'p1', status: 'exited', exitCode: 0, output: 'Tests passed' } }))
  const result = await run(({ request }) => request === 1
    ? response({ content: null, tool_calls: [call('process_start', { command: 'npm test' })] })
    : request === 2
      ? response({ content: null, tool_calls: [call('process_poll', { process_id: 'p1' })] })
      : response({ content: 'Tests passed.' }), [processStart, processPoll], {
        taskState: { goal: 'Run tests', constraints: [], acceptanceCriteria: ['npm test passes'], confirmedFacts: [], nextStep: '' }
      })
  assert.equal(result.summary.checks.length, 1)
  assert.equal(result.summary.checks[0].toolName, 'process_poll')
  assert.equal(result.summary.checks[0].command, 'npm test')
  assert.equal(result.summary.checks[0].passed, true)
  assert.equal(result.summary.verificationStatus, 'verified')
})

test('failed latest validation remains visible as failed and blocks a fully-ready claim', async () => {
  const verify = tool('verify', async () => ({ formattedContent: 'CHECK FAILED: Output is valid', error: true }))
  const result = await run(({ request }) => request === 1
    ? response({ content: null, tool_calls: [call('verify')] })
    : response({ content: 'Everything is fully ready.' }), [verify], {
      taskState: { goal: 'Check output', constraints: [], acceptanceCriteria: ['Output is valid'], confirmedFacts: [], nextStep: '' }
    })
  assert.equal(result.summary.checks.at(-1).passed, false)
  assert.equal(result.summary.verificationStatus, 'failed')
  assert.match(JSON.stringify(result.events), /проверка завершилась ошибкой/)
})

test('successful exit-zero command is recorded as a check but not as artifact verification', async () => {
  const history = [
    { role: 'user', content: 'Create expected.txt with READY and verify it.' }
  ]
  const terminal = tool('terminal', async () => ({ formattedContent: '$ generate expected.txt\n\ncompleted (exit code 0)', data: { exitCode: 0, command: 'generate expected.txt' }, success: true }), true)
  const result = await run(({ request }) => request === 1
    ? response({ content: null, tool_calls: [call('terminal', { command: 'generate expected.txt' })] })
    : response({ content: 'Task is fully complete.' }), [terminal], { taskState: { goal: history[0].content, constraints: [], acceptanceCriteria: ['expected.txt contains READY'], confirmedFacts: [], nextStep: '' } }, history)
  assert.equal(result.summary.checks.length, 0)
  assert.equal(result.summary.verificationStatus, 'unverified')
  assert.match(result.events.filter(event => event.type === 'token').map(event => event.content).join('') + JSON.stringify(result.events), /не провер|unverified/i)
})

test('a successful build cannot verify an unrelated file-content criterion', async () => {
  const terminal = tool('terminal', async () => ({ formattedContent: '$ npm run build\nbuild log mentions expected.txt READY but does not assert its contents\n(завершено с кодом 0)', data: { exitCode: 0, command: 'npm run build', stdout: 'build log mentions expected.txt READY but does not assert its contents' }, success: true }), true)
  const result = await run(({ request }) => request === 1
    ? response({ content: null, tool_calls: [call('terminal', { command: 'npm run build' })] })
    : response({ content: 'Build is complete.' }), [terminal], {
      taskState: { goal: 'Build and check artifact', constraints: [], acceptanceCriteria: ['expected.txt contains READY'], confirmedFacts: [], nextStep: '' }
    })
  assert.equal(result.summary.checks[0].passed, true)
  assert.equal(result.summary.verificationStatus, 'unverified')
  assert.deepEqual(result.summary.unverifiedCriteria, ['expected.txt contains READY'])
})

test('reading a file stays an observation while verify_file verifies a file-content criterion', async () => {
  const readFile = tool('read_file', async () => ({
    success: true,
    formattedContent: 'Файл: expected.txt\n1 | READY',
    data: { path: 'expected.txt', content: 'READY' }
  }))
  const criteriaState = { goal: 'Check the artifact', constraints: [], acceptanceCriteria: ['expected.txt contains READY'], confirmedFacts: [], nextStep: '' }
  const readOnlyResult = await run(({ request }) => request === 1
    ? response({ content: null, tool_calls: [call('read_file', { path: 'expected.txt' })] })
    : response({ content: 'expected.txt contains READY.' }), [readFile], {
      taskState: criteriaState
    })
  assert.equal(readOnlyResult.summary.verificationStatus, 'unverified', JSON.stringify(readOnlyResult.summary))
  assert.deepEqual(readOnlyResult.summary.unverifiedCriteria, ['expected.txt contains READY'])

  const verifyFile = tool('verify_file', async () => ({
    success: true,
    formattedContent: 'PASS: expected.txt contains READY',
    data: { passed: true, path: 'expected.txt', criterionId: 'c_1', assertion: 'contains' }
  }))
  const verifiedResult = await run(({ request }) => request === 1
    ? response({ content: null, tool_calls: [call('verify_file', { path: 'expected.txt', assertion: 'contains', expected: 'READY', criterion_id: 'c_1' })] })
    : response({ content: 'Verified expected.txt contains READY.' }), [verifyFile], {
      taskState: criteriaState
    })
  assert.equal(verifiedResult.summary.verificationStatus, 'verified', JSON.stringify(verifiedResult.summary))
  assert.deepEqual(verifiedResult.summary.unverifiedCriteria, [])
})

test('process_start can record a completed process only when it returns terminal status and exit code', async () => {
  const processStart = tool('process_start', async () => ({ success: true, formattedContent: 'Process p2: exited', data: { id: 'p2', status: 'exited', exitCode: 0 } }), true)
  const result = await run(({ request }) => request === 1
    ? response({ content: null, tool_calls: [call('process_start', { command: 'npm test' })] })
    : response({ content: 'Tests passed.' }), [processStart], {
      taskState: { goal: 'Run tests', constraints: [], acceptanceCriteria: ['npm test passes'], confirmedFacts: [], nextStep: '' }
    })
  assert.equal(result.summary.checks.length, 1)
  assert.equal(result.summary.checks[0].passed, true)
})

test('round, token and elapsed-time limits are opt-in', async () => {
  const lookup = tool('lookup', async () => ({ formattedContent: 'one result' }))
  let tokenCalls = 0
  const countedLookup = tool('lookup', async () => { tokenCalls++; return { formattedContent: 'one result' } })
  const byTokens = await run(({ request }) => request === 1 ? response({ content: null, tool_calls: [call('lookup')] }, 10) : response({ content: 'Finished.' }), [countedLookup], { runLimits: { tokens: 5 } })
  assert.equal(byTokens.summary.reason, 'limit_tokens')
  assert.equal(tokenCalls, 0)
  const byTime = await run(async ({ request }) => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return request === 1 ? response({ content: null, tool_calls: [call('lookup')] }) : response({ content: 'Finished.' })
  }, [lookup], { runLimits: { timeMs: 1 } })
  assert.equal(byTime.summary.reason, 'limit_time')
  const finalOverBudget = await run(() => response({ content: 'The final response is preserved.' }, 50), [], { runLimits: { tokens: 5 } })
  assert.equal(finalOverBudget.summary.reason, 'limit_tokens')
  assert.ok(finalOverBudget.events.some(event => event.type === 'done'))
  assert.match(JSON.stringify(finalOverBudget.events), /final response is preserved/i)
})

test('a provider response arriving after the deadline is preserved but not reported completed', async () => {
  const lateFinal = await run(async () => {
    await new Promise(resolve => setTimeout(resolve, 60))
    return response({ content: 'Late final answer is preserved.' })
  }, [], { runLimits: { timeMs: 25 } })
  assert.equal(lateFinal.summary.reason, 'limit_time')
  assert.ok(lateFinal.events.some(event => event.type === 'done'))
  assert.match(JSON.stringify(lateFinal.events), /Late final answer is preserved/)

  let executions = 0
  const lookup = tool('lookup', async () => { executions++; return { formattedContent: 'should not execute' } })
  const lateTools = await run(async () => {
    await new Promise(resolve => setTimeout(resolve, 60))
    return response({ content: null, tool_calls: [call('lookup')] })
  }, [lookup], { runLimits: { timeMs: 25 } })
  assert.equal(lateTools.summary.reason, 'limit_time')
  assert.equal(executions, 0)
})

test('missing provider usage is estimated and enforces the soft token budget before tool execution', async () => {
  let executions = 0
  const lookup = tool('lookup', async () => { executions++; return { formattedContent: 'should not run' } })
  const result = await run(() => Response.json({ choices: [{ message: { content: null, tool_calls: [call('lookup')] } }] }), [lookup], {
    runLimits: { tokens: 20 }
  }, [{ role: 'user', content: 'x'.repeat(400) }])
  assert.equal(result.summary.reason, 'limit_tokens')
  assert.equal(executions, 0)
  assert.equal(result.summary.usage.estimated, true)
  assert.equal(result.summary.usage.estimateMethod, 'serialized characters ÷ 3.2')
  assert.equal(result.summary.usage.complete, false)
  assert.match(result.summary.message, /оценён|оценен|приблиз/i)
})

