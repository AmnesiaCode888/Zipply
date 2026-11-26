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

test('large streamed file previews retain their content without retransmitting the growing argument buffer', async () => {
  const { runAgent } = load('src/main/agent/index.ts')
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const savedFetch = global.fetch
  const content = 'строка 😀 with escapes " and \\n\n'.repeat(500)
  const args = JSON.stringify({ path: 'test.txt', content })
  const chunks = args.match(/[\s\S]{1,80}/g)
  const deltas = chunks.map((chunk, index) => ({ tool_calls: [{ index: 0, ...(index === 0 ? { id: 'large' } : {}), function: { ...(index === 0 ? { name: 'write_file' } : {}), arguments: chunk } }] }))
  global.fetch = async () => new Response(deltas.map(delta => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join('') + 'data: [DONE]\n\n')
  const abort = new AbortController()
  const events = []
  const blocks = []
  const message = { id: 'm', role: 'assistant', isStreaming: true }
  try {
    await runAgent('zipply', [{ role: 'user', content: 'write' }], { model: 'test', planMode: true }, event => {
      if (event.type !== 'tool_call_stream') return
      events.push(event)
      applyEventToBlocks(event, blocks, message)
      if (events.length === chunks.length) abort.abort()
    }, abort.signal)
    assert.equal(events.length, chunks.length)
    assert.equal(blocks[0].tool.targetName, 'test.txt')
    assert.equal(blocks[0].tool.content, content)
    const transmitted = events.reduce((sum, event) => sum + (event.argsDelta?.length || 0) + (event.argsBuffer?.length || 0), 0)
    assert.ok(transmitted <= args.length * 2, `argument traffic ${transmitted} exceeds twice ${args.length}`)
  } finally { global.fetch = savedFetch }
})

test('interleaved tool deltas and baseline events retain their independent previews', () => {
  const { applyEventToBlocks } = load('src/renderer/src/hooks/useChat.ts')
  const blocks = [], message = { id: 'm', role: 'assistant', isStreaming: true }
  const a = JSON.stringify({ path: 'one.txt', content: 'привет 😀\n"ok"' })
  const b = JSON.stringify({ path: 'two.txt', content: 'second\\file' })
  for (let i = 0; i < Math.max(a.length, b.length); i += 3) {
    if (i < a.length) applyEventToBlocks({ type: 'tool_call_stream', callId: 'a', toolName: 'write_file', argsDelta: a.slice(i, i + 3) }, blocks, message)
    if (i === 9) applyEventToBlocks({ type: 'tool_baseline', callId: 'a', content: 'old' }, blocks, message)
    if (i < b.length) applyEventToBlocks({ type: 'tool_call_stream', callId: 'b', toolName: 'write_file', argsDelta: b.slice(i, i + 3) }, blocks, message)
  }
  assert.equal(blocks.find(x => x.id === 'a').tool.content, 'привет 😀\n"ok"')
  assert.equal(blocks.find(x => x.id === 'a').tool.baseline, 'old')
  assert.equal(blocks.find(x => x.id === 'b').tool.content, 'second\\file')
})

test('a provider error ends a partially streamed tool and it stays ended when restored', () => {
  const { applyEventsToMessages } = load('src/renderer/src/hooks/useChat.ts')
  const { finishInterruptedMessages } = load('src/renderer/src/services/chatStorageService.ts')
  const messages = [{ id: 'm', role: 'assistant', isStreaming: true, blocks: [] }]
  const updated = applyEventsToMessages(messages, [
    { type: 'tool_call_stream', callId: 'call', toolName: 'write_file', argsDelta: '{"path":"a.txt","content":"partial' },
    { type: 'error', message: 'stream interrupted' }
  ])
  assert.equal(updated[0].isStreaming, false)
  assert.equal(updated[0].blocks[0].tool.status, 'error')
  assert.equal(finishInterruptedMessages(updated)[0].blocks[0].tool.status, 'error')
})

test('startup recovery exposes Retry after a crash even when a user correction followed the partial assistant response', () => {
  const { finishInterruptedMessages } = load('src/renderer/src/services/chatStorageService.ts')
  const messages = [
    { id: 'first', role: 'user', content: 'Save the file' },
    { id: 'partial', role: 'assistant', content: 'Saving the file…', isStreaming: true },
    { id: 'corrected', role: 'user', content: 'Leave the file unchanged' }
  ]
  const recovered = finishInterruptedMessages(messages)
  assert.equal(recovered[1].isStreaming, false)
  assert.equal(recovered[1].content, 'Saving the file…')
  assert.equal(recovered[2].content, 'Leave the file unchanged')
  assert.equal(recovered.at(-1).role, 'assistant')
  assert.match(recovered.at(-1).blocks[0].content, /^⚠️/)
  assert.deepEqual(finishInterruptedMessages(recovered), recovered)
})
