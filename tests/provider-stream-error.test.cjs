const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const source = path.resolve(file)
  const output = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(output.outputFiles[0].text, source)
  return mod.exports
}

const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
const { applyEventsToMessages } = load('src/renderer/src/hooks/useChat.ts')
const agent = { id: 'test', getTools: () => [], getHandler: () => undefined }
const sse = value => `data: ${JSON.stringify(value)}\n\n`

test('provider error before any output reaches the agent as an error, not done', async () => {
  const originalFetch = global.fetch
  const events = []
  let requests = 0
  global.fetch = async () => {
    requests++
    return new Response(sse({ error: { message: 'provider quota exceeded', code: 429 } }) + 'data: [DONE]\n\n')
  }
  try {
    await AgentRunner.run(agent, [{ role: 'user', content: 'hi' }], { model: 'test' }, event => events.push(event))
    assert.equal(events.some(event => event.type === 'done'), false)
    assert.match(events.find(event => event.type === 'error')?.message || '', /provider quota exceeded/)
    assert.equal(events.some(event => event.type === 'token'), false)
    assert.equal(requests, 4)
  } finally { global.fetch = originalFetch }
})

test('provider error after partial output preserves it without retry or done', async () => {
  const originalFetch = global.fetch
  const events = []
  let requests = 0
  global.fetch = async () => {
    requests++
    return new Response(
      sse({ choices: [{ delta: { content: 'Partial answer <thi' } }] }) +
      sse({ error: { message: 'upstream failed', code: 502 } }) + 'data: [DONE]\n\n'
    )
  }
  try {
    await AgentRunner.run(agent, [{ role: 'user', content: 'hi' }], { model: 'test' }, event => events.push(event))
    assert.equal(requests, 1)
    assert.equal(events.some(event => event.type === 'done'), false)
    assert.match(events.find(event => event.type === 'error')?.message || '', /upstream failed/)
    const [message] = applyEventsToMessages([{ id: 'a', role: 'assistant', blocks: [], isStreaming: true }], events)
    assert.equal(message.isStreaming, false)
    assert.equal(message.blocks[0].content, 'Partial answer <thi')
    assert.match(message.blocks.at(-1).content, /upstream failed/)
  } finally { global.fetch = originalFetch }
})

test('runAgent preserves partial text and never executes list_dir on aborted Chat Completions SSE or Responses response.incomplete', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const originalFetch = global.fetch

  // 1. Truncated Chat Completions SSE
  let listDirCalls = 0
  const events1 = []
  global.fetch = async () => new Response(
    sse({ choices: [{ delta: { content: 'Partial SSE ' } }] }) +
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_trunc', function: { name: 'list_dir', arguments: '' } }] } }] })
  )
  try {
    await runAgent('zipply', [{ role: 'user', content: 'check dir' }], { model: 'test' }, e => {
      if (e.type === 'tool_start' && e.toolName === 'list_dir') listDirCalls++
      events1.push(e)
    })
    assert.equal(listDirCalls, 0)
    assert.equal(events1.some(e => e.type === 'done'), false)
    assert.equal(events1.findLast(e => e.type === 'run_summary')?.summary?.reason, 'incomplete')
    const [msg1] = applyEventsToMessages([{ id: 'a1', role: 'assistant', blocks: [], isStreaming: true }], events1)
    assert.equal(msg1.isStreaming, false)
    assert.match(msg1.blocks[0].content, /Partial SSE/)
    assert.equal(msg1.blocks.some(b => b.type === 'tool' && b.tool.status === 'completed'), false)
  } finally { global.fetch = originalFetch }

  // 2. Responses API response.incomplete
  listDirCalls = 0
  const events2 = []
  global.fetch = async () => new Response(
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Partial Resp "}\n\n' +
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":1,"item":{"id":"fc_1","type":"function_call","call_id":"call_inc","name":"list_dir","arguments":""}}\n\n' +
    'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"id":"r_inc","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n'
  )
  try {
    await runAgent('zipply', [{ role: 'user', content: 'check dir' }], { model: 'gpt-5', apiMode: 'responses', stream: true }, e => {
      if (e.type === 'tool_start' && e.toolName === 'list_dir') listDirCalls++
      events2.push(e)
    })
    assert.equal(listDirCalls, 0)
    assert.equal(events2.some(e => e.type === 'done'), false)
    assert.equal(events2.findLast(e => e.type === 'run_summary')?.summary?.reason, 'incomplete')
    const [msg2] = applyEventsToMessages([{ id: 'a2', role: 'assistant', blocks: [], isStreaming: true }], events2)
    assert.equal(msg2.isStreaming, false)
    assert.match(msg2.blocks[0].content, /Partial Resp/)
  } finally { global.fetch = originalFetch }
})
