const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module); mod.filename = path.resolve(file); mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename); return mod.exports
}

test('independent reads overlap while mutations remain barriers and results keep call order', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const board = new Blackboard(); const timeline = []
  board.setArtifact('config', { workspacePath: process.cwd(), accessMode: 'automatic' })
  const tool = { name: 'op', validate: () => null, getExecutionPolicy: a => ({ mutates: a.mutate, parallelSafe: !a.mutate, cacheable: false }), execute: async raw => {
    const { id } = JSON.parse(raw); timeline.push(`start-${id}`)
    await new Promise(resolve => setTimeout(resolve, id === 'a' ? 35 : 5))
    timeline.push(`end-${id}`); return { formattedContent: id }
  } }
  const calls = [{ id: 'a' }, { id: 'b' }, { id: 'c', mutate: true }, { id: 'd' }].map(a => ({ id: a.id, name: 'op', argumentsJson: JSON.stringify(a) }))
  const messages = []
  await ToolExecutor.executeCalls({ getHandler: () => tool }, calls, messages, board, () => {})
  assert.ok(timeline.indexOf('start-b') < timeline.indexOf('end-a'))
  assert.ok(timeline.indexOf('start-c') > timeline.indexOf('end-a'))
  assert.ok(timeline.indexOf('start-d') > timeline.indexOf('end-c'))
  assert.deepEqual(messages.map(m => m.tool_call_id), ['a', 'b', 'c', 'd'])
})

test('batch read requires approval for every external file and refuses the whole batch', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-batch-')); const root = path.join(base, 'root'); await fs.mkdir(root)
  const approved = []; let executed = false; const board = new Blackboard()
  board.setArtifact('config', { workspacePath: root, accessMode: 'automatic', confirmAction: async action => { approved.push(action.target); return approved.length === 1 } })
  const tool = { name: 'read_files', validate: () => null, getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: false }), execute: async () => { executed = true; return { formattedContent: 'unsafe' } } }
  try {
    const messages = []; await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: '1', name: 'read_files', argumentsJson: JSON.stringify({ files: [{ path: '../one' }, { path: '../two' }] }) }], messages, board, () => {})
    assert.equal(approved.length, 2); assert.equal(executed, false); assert.match(messages[0].content, /отклон/i)
  } finally { await fs.rm(base, { recursive: true, force: true }) }
})

test('approved batch reads use the canonical target even if a junction changes after approval', async (t) => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts'); const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-batch-link-')); const root = path.join(base, 'root'); const first = path.join(base, 'first'); const second = path.join(base, 'second'); const link = path.join(root, 'link')
  await fs.mkdir(root); await fs.mkdir(first); await fs.mkdir(second)
  await fs.writeFile(path.join(first, 'a.txt'), 'approved'); await fs.writeFile(path.join(second, 'a.txt'), 'unapproved')
  const board = new Blackboard(); board.setArtifact('config', { workspacePath: root, accessMode: 'automatic', confirmAction: async () => { await fs.unlink(link); await fs.symlink(second, link, process.platform === 'win32' ? 'junction' : 'dir'); return true } })
  const tool = { name: 'read_files', validate: () => null, getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: false }), execute: async raw => ({ formattedContent: await fs.readFile(JSON.parse(raw).files[0].path, 'utf8') }) }
  try {
    try { await fs.symlink(first, link, process.platform === 'win32' ? 'junction' : 'dir') }
    catch (err) { if (['EPERM', 'EACCES'].includes(err?.code)) { t.skip('junction/symlink not permitted in environment'); return } throw err }
    const messages = []; await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: '1', name: 'read_files', argumentsJson: JSON.stringify({ files: [{ path: 'link/a.txt' }] }) }], messages, board, () => {})
    assert.equal(messages[0].content, 'approved')
  } finally { await fs.rm(base, { recursive: true, force: true }) }
})

test('read_files schema exposes array item definitions', () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const tool = { name: 'read_files', description: '', getExecutionPolicy: () => ({ mutates: false }), parameters: { files: { type: 'array', required: true, description: '', items: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } } }
  const [definition] = ToolExecutor.buildToolDefs({ getTools: () => [tool] })
  assert.equal(definition.function.parameters.properties.files.items.properties.path.type, 'string')
})

test('long current turn is compacted without breaking latest tool call and result pair', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const pair = (id, content) => [{ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: id, content }]
  const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'original goal' }, ...pair('one', 'old '.repeat(1500)), ...pair('two', 'latest result')]
  const result = await ContextCompactor.compactAsync(messages, { contextLength: 1200, summarize: async () => 'Found relevant file' })
  assert.match(JSON.stringify(result), /original goal/); assert.match(JSON.stringify(result), /Found relevant file/)
  assert.equal(result.at(-2).tool_calls[0].id, 'two'); assert.equal(result.at(-1).tool_call_id, 'two')
})

test('one oversized tool result can fit without dropping its call', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'goal' }, { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'one', content: 'long result '.repeat(1000) }]
  const result = await ContextCompactor.compactAsync(messages, { contextLength: 500, summarize: async () => 'unused' })
  assert.equal(result.at(-2).tool_calls[0].id, 'one'); assert.equal(result.at(-1).tool_call_id, 'one'); assert.ok(result.at(-1).content.length < 1400)
})

test('summary usage contributes to total and missing usage is marked incomplete', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts'); const original = global.fetch; let count = 0
  global.fetch = async () => { count++; return Response.json({ choices: [{ message: { content: count === 1 ? 'summary' : 'done' } }], ...(count === 1 ? { usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } } : {}) }) }
  const events = []
  try {
    await AgentRunner.run({ id: 'zipply', getTools: () => [], getHandler: () => undefined }, [{ role: 'user', content: 'old task' }, { role: 'assistant', content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'old', content: 'old '.repeat(7000) }, { role: 'user', content: 'latest' }], { stream: false, contextLength: 5000 }, e => events.push(e))
    assert.equal(events.at(-1).usage.totalTokens, 12); assert.equal(events.at(-1).usage.complete, false)
  } finally { global.fetch = original }
})

test('failed tool results are retried rather than returned from cache', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts'); const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  let attempts = 0; const board = new Blackboard(); board.setArtifact('config', { workspacePath: process.cwd() })
  const tool = { name: 'flaky', validate: () => null, getExecutionPolicy: () => ({ mutates: false, parallelSafe: true, cacheable: true }), execute: async () => ++attempts === 1 ? { formattedContent: 'offline', error: true } : { formattedContent: 'recovered' } }
  const cache = new Map(); const messages = []; const call = { id: '1', name: 'flaky', argumentsJson: '{}' }
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [call], messages, board, () => {}, undefined, cache)
  await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ ...call, id: '2' }], messages, board, () => {}, undefined, cache)
  assert.equal(messages[1].content, 'recovered')
})

test('summarization bounds oversized old tool output and preserves protocol and original history', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'old task' }, { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'one', content: 'x'.repeat(40000) }, { role: 'user', content: 'new task' }]
  let summarized
  await ContextCompactor.compactAsync(messages, { contextLength: 2000, summaryInputBudgetTokens: 800, summarize: async input => { summarized = input; return 'summary' } })
  assert.equal(summarized[1].tool_calls[0].id, 'one'); assert.equal(summarized[2].tool_call_id, 'one')
  assert.match(summarized[2].content, /усеч/i); assert.ok(JSON.stringify(summarized).length < 2560); assert.equal(messages[3].content.length, 40000)
})

test('summary fails safely when non-tool content alone exceeds its input budget', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'important '.repeat(2000) }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'latest' }]
  let called = false
  await assert.rejects(ContextCompactor.compactAsync(messages, { contextLength: 1000, summaryInputBudgetTokens: 500, summarize: async () => { called = true; return 'summary' } }), /История сохранена/)
  assert.equal(called, false); assert.equal(messages[1].content, 'important '.repeat(2000))
})

test('partial provider usage is explicitly incomplete', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts'); const original = global.fetch
  global.fetch = async () => Response.json({ choices: [{ message: { content: 'done' } }], usage: { prompt_tokens: 7 } })
  const events = []
  try {
    await AgentRunner.run({ id: 'zipply', getTools: () => [], getHandler: () => undefined }, [{ role: 'user', content: 'hello' }], { stream: false }, e => events.push(e))
    assert.equal(events.at(-1).usage.promptTokens, 7); assert.equal(events.at(-1).usage.complete, false)
  } finally { global.fetch = original }
})

test('provider context overflow does not retry an identical request when compaction cannot shorten it', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts'); const original = global.fetch; let requests = 0
  global.fetch = async () => { requests++; return new Response('maximum context length exceeded', { status: 400 }) }
  const events = []
  const history = [{ role: 'user', content: 'goal' }, { role: 'assistant', content: null, tool_calls: [{ id: 'one', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'one', content: 'x'.repeat(300) }]
  try {
    await AgentRunner.run({ id: 'zipply', getTools: () => [], getHandler: () => undefined }, history, { stream: false, contextLength: 128000 }, e => events.push(e))
    assert.equal(requests, 1); assert.equal(events.at(-1).type, 'error'); assert.match(events.at(-1).message, /контекст/i)
  } finally { global.fetch = original }
})

test('non-object JSON arguments return tool errors without breaking call protocol', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts'); const { Blackboard } = load('src/main/agent/core/Blackboard.ts'); const { ReadFileTool } = load('src/main/agent/tools/ReadFileTool.ts')
  const board = new Blackboard(); board.setArtifact('config', { workspacePath: process.cwd() })
  const tool = new ReadFileTool(); const messages = []; const events = []
  const calls = ['null', '[]', '42'].map((argumentsJson, index) => ({ id: String(index), name: 'read_file', argumentsJson }))
  assert.equal(await ToolExecutor.executeCalls({ getHandler: () => tool }, calls, messages, board, e => events.push(e)), true)
  assert.deepEqual(messages.map(m => m.tool_call_id), ['0', '1', '2']); assert.equal(events.filter(e => e.type === 'tool_result' && e.error).length, 3)
})

test('cancelling between writes persists completed work and cancelled results for remaining calls', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts'); const original = global.fetch; const controller = new AbortController(); const executed = []
  global.fetch = async () => Response.json({ choices: [{ message: { content: null, tool_calls: ['one', 'two'].map(id => ({ id, type: 'function', function: { name: 'modify', arguments: JSON.stringify({ id }) } })) } }] })
  const tool = { name: 'modify', description: '', parameters: {}, validate: () => null, getExecutionPolicy: () => ({ mutates: true, parallelSafe: false, cacheable: false }), execute: async raw => { const { id } = JSON.parse(raw); executed.push(id); return { formattedContent: `saved ${id}` } } }
  const events = []
  try {
    await AgentRunner.run({ id: 'zipply', getTools: () => [tool], getHandler: () => tool }, [{ role: 'user', content: 'modify' }], { stream: false }, event => { events.push(event); if (event.type === 'tool_result' && event.result === 'saved one') controller.abort() }, controller.signal)
    assert.deepEqual(executed, ['one']); const history = events.filter(e => e.type === 'history').at(-1).messages
    assert.deepEqual(history.filter(m => m.role === 'tool').map(m => m.tool_call_id), ['one', 'two'])
    assert.match(history.find(m => m.tool_call_id === 'one').content, /saved one/); assert.match(history.find(m => m.tool_call_id === 'two').content, /отмен/i)
    assert.equal(events.at(-1).type, 'error')
  } finally { global.fetch = original }
})

test('cancelling an in-flight mutation records its outcome as unknown', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts'); const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const controller = new AbortController(); const board = new Blackboard(); board.setArtifact('config', { workspacePath: process.cwd() })
  const tool = { name: 'modify', validate: () => null, getExecutionPolicy: () => ({ mutates: true, parallelSafe: false, cacheable: false }), execute: async () => { controller.abort(); return { formattedContent: 'cancelled', error: true } } }
  const messages = []; const events = []
  assert.equal(await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: 'one', name: 'modify', argumentsJson: '{}' }, { id: 'two', name: 'modify', argumentsJson: '{}' }], messages, board, e => events.push(e), controller.signal), false)
  assert.deepEqual(messages.map(m => m.tool_call_id), ['one', 'two']); assert.match(messages[0].content, /результат неизвестен/); assert.match(messages[1].content, /отмен/i)
  assert.equal(events.filter(e => e.type === 'tool_result').length, 2)
})
