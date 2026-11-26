const test = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')

function load(file) {
  const source = path.resolve(file)
  const output = buildSync({ entryPoints: [source], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external', loader: { '.svg': 'dataurl', '.css': 'empty' } })
  const mod = new Module(source, module)
  mod.filename = source
  mod.paths = module.paths
  mod._compile(output.outputFiles[0].text, source)
  return mod.exports
}

test('late provider call ID preserves live preview and baseline while keeping provider protocol', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-late-id-'))
  const originalFetch = global.fetch
  const events = []
  const blocks = []
  const message = { id: 'm', role: 'assistant', isStreaming: true }
  const encoder = new TextEncoder()
  const providerId = 'provider-call-id-123'
  let controller
  let pending
  const abort = new AbortController()
  let request = 0
  let nextMessages
  const tool = {
    name: 'write_file', description: '', parameters: {}, validate: () => null,
    getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: false }),
    execute: async () => ({ formattedContent: 'complete', success: true })
  }
  const agent = { id: 'test', getTools: () => [tool], getHandler: name => name === tool.name ? tool : undefined }
  global.fetch = async (_url, options) => {
    if (++request === 1) return new Response(new ReadableStream({ start(stream) { controller = stream } }))
    nextMessages = JSON.parse(options.body).messages
    return new Response('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n')
  }
  const send = delta => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`))
  const until = async predicate => {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 2))
    assert.ok(predicate(), 'timed out waiting for stream event')
  }
  try {
    await fs.writeFile(path.join(dir, 'a.txt'), 'original')
    pending = AgentRunner.run(agent, [{ role: 'user', content: 'write' }], { model: 'test', workspacePath: dir }, event => {
      events.push(event)
      applyEventToBlocks(event, blocks, message)
    }, abort.signal)
    await until(() => controller)
    send({ tool_calls: [{ index: 0, function: { name: 'write_file', arguments: '{"path":"a.txt","content":"first' } }] })
    await until(() => events.some(event => event.type === 'tool_baseline'))
    const early = blocks.find(block => block.type === 'tool')
    assert.equal(early.tool.content, 'first')
    assert.equal(early.tool.baseline, 'original')
    send({ tool_calls: [{ index: 0, id: providerId, function: { arguments: ' second"}' } }] })
    await until(() => events.filter(event => event.type === 'tool_call_stream').length === 2)
    assert.equal(blocks.filter(block => block.type === 'tool').length, 1)
    assert.equal(blocks.find(block => block.type === 'tool').tool.content, 'first second')
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()
    await pending

    const card = blocks.filter(block => block.type === 'tool')
    assert.equal(card.length, 1)
    assert.equal(card[0].tool.baseline, 'original')
    assert.equal(card[0].tool.status, 'completed')
    const ids = events.filter(event => ['tool_call_stream', 'tool_baseline', 'tool_start', 'tool_result'].includes(event.type)).map(event => event.callId)
    assert.equal(new Set(ids).size, 1)
    const assistant = nextMessages.find(item => item.tool_calls)
    assert.equal(assistant.tool_calls[0].id, providerId)
    assert.equal(nextMessages.find(item => item.role === 'tool').tool_call_id, providerId)
    assert.deepEqual(JSON.parse(assistant.tool_calls[0].function.arguments), { path: 'a.txt', content: 'first second' })
  } finally {
    abort.abort()
    try { controller?.close() } catch {}
    if (pending) await pending
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('interleaved calls keep distinct stream IDs whether provider IDs are early, late or absent', async () => {
  const { ChatService } = load('src/main/agent/services/ChatService.ts')
  const originalFetch = global.fetch
  const deltas = [
    { tool_calls: [
      { index: 0, function: { name: 'first', arguments: '{"x":' } },
      { index: 1, id: 'early', function: { name: 'second', arguments: '{"y":' } },
      { index: 2, function: { name: 'third', arguments: '{"z":' } }
    ] },
    { tool_calls: [
      { index: 1, id: 'early', function: { arguments: '2}' } },
      { index: 0, id: 'late', function: { arguments: '1}' } },
      { index: 2, function: { arguments: '3}' } }
    ] }
  ]
  global.fetch = async () => new Response(deltas.map(delta => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join(''))
  try {
    const streamed = []
    const response = await ChatService.chat({ model: 'test' }, [{ role: 'user', content: 'hi' }], undefined, undefined, undefined,
      (id, name) => streamed.push({ id, name }))
    const byName = name => streamed.filter(item => item.name === name).map(item => item.id)
    for (const name of ['first', 'second', 'third']) assert.equal(new Set(byName(name)).size, 1)
    assert.equal(new Set(streamed.map(item => item.id)).size, 3)
    assert.deepEqual(response.toolCalls.map(call => call.id).slice(0, 2), ['late', 'early'])
    assert.equal(response.toolCalls[2].id, byName('third')[0])
    assert.equal(response.toolCalls[0].streamId, byName('first')[0])
    assert.deepEqual(response.toolCalls.map(call => JSON.parse(call.argumentsJson)), [{ x: 1 }, { y: 2 }, { z: 3 }])
  } finally { global.fetch = originalFetch }
})

test('reused provider call IDs across turns keep separate cards and fresh baselines', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-repeated-id-'))
  const originalFetch = global.fetch
  const events = []
  const blocks = []
  const message = { id: 'm', role: 'assistant', isStreaming: true }
  let request = 0
  let finalMessages
  const tool = {
    name: 'write_file', description: '', parameters: {}, validate: () => null,
    getExecutionPolicy: () => ({ mutates: true, cacheable: false, parallelSafe: false }),
    execute: async raw => {
      const args = JSON.parse(raw)
      await fs.writeFile(path.join(dir, args.path), args.content)
      return { formattedContent: args.content, success: true }
    }
  }
  const agent = { id: 'test', getTools: () => [tool], getHandler: name => name === tool.name ? tool : undefined }
  global.fetch = async (_url, options) => {
    request++
    if (request <= 2) {
      const delta = { tool_calls: [{ index: 0, id: 'call_0', function: { name: 'write_file', arguments: JSON.stringify({ path: 'a.txt', content: `version-${request}` }) } }] }
      return new Response(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
    }
    finalMessages = JSON.parse(options.body).messages
    return new Response('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n')
  }
  try {
    await fs.writeFile(path.join(dir, 'a.txt'), 'original')
    await AgentRunner.run(agent, [{ role: 'user', content: 'write twice' }], { model: 'test', workspacePath: dir }, event => {
      events.push(event)
      applyEventToBlocks(event, blocks, message)
    })
    const cards = blocks.filter(block => block.type === 'tool')
    assert.equal(cards.length, 2)
    assert.notEqual(cards[0].id, cards[1].id)
    assert.deepEqual(cards.map(card => card.tool.baseline), ['original', 'version-1'])
    assert.deepEqual(cards.map(card => card.tool.status), ['completed', 'completed'])
    assert.deepEqual(events.filter(event => event.type === 'tool_baseline').map(event => event.callId), cards.map(card => card.id))
    assert.deepEqual(finalMessages.filter(item => item.tool_calls).map(item => item.tool_calls[0].id), ['call_0', 'call_0'])
    assert.deepEqual(finalMessages.filter(item => item.role === 'tool').map(item => item.tool_call_id), ['call_0', 'call_0'])
  } finally {
    global.fetch = originalFetch
    await fs.rm(dir, { recursive: true, force: true })
  }
})
