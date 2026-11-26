const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function loadChatService() {
  const file = path.resolve('src/main/agent/services/ChatService.ts')
  const output = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(file, module)
  mod.filename = file
  mod.paths = module.paths
  mod._compile(output.outputFiles[0].text, file)
  return mod.exports.ChatService
}

test('a completed stream succeeds even if the connection terminates after DONE', async () => {
  const ChatService = loadChatService()
  const original = global.fetch
  let cancelled = false
  global.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Готово"}}]}\n\ndata: [DONE]\n\n'))
      setTimeout(() => { if (!cancelled) controller.error(new TypeError('terminated')) }, 0)
    },
    cancel() { cancelled = true }
  }))
  try {
    const response = await ChatService.chat({ model: 'test' }, [{ role: 'user', content: 'hi' }], undefined, () => {})
    assert.equal(response.content, 'Готово')
    assert.equal(response.status, 'completed')
  } finally { global.fetch = original }
})

test('Chat Completions SSE without DONE or terminal finish_reason is marked truncated_stream', async () => {
  const ChatService = loadChatService()
  const original = global.fetch
  global.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"Part ","tool_calls":[{"index":0,"id":"c1","function":{"name":"list_dir","arguments":""}}]}}]}\n\n'
  )
  try {
    const response = await ChatService.chat({ model: 'test' }, [{ role: 'user', content: 'list' }], undefined, () => {})
    assert.equal(response.status, 'truncated_stream')
    assert.equal(response.content, 'Part ')
  } finally { global.fetch = original }
})

test('Chat Completions SSE with finish_reason length is marked incomplete even with DONE', async () => {
  const ChatService = loadChatService()
  const original = global.fetch
  global.fetch = async () => new Response(
    'data: {"choices":[{"delta":{"content":"Cut off"}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n' +
    'data: [DONE]\n\n'
  )
  try {
    const response = await ChatService.chat({ model: 'test' }, [{ role: 'user', content: 'hi' }], undefined, () => {})
    assert.equal(response.status, 'incomplete')
    assert.equal(response.finishReason, 'length')
  } finally { global.fetch = original }
})

test('Responses API stream handles response.incomplete and truncated EOF without completed event', async () => {
  const ChatService = loadChatService()
  const original = global.fetch
  global.fetch = async () => new Response(
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Half "}\n\n' +
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":1,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"list_dir","arguments":""}}\n\n' +
    'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"id":"r1","status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n'
  )
  try {
    const res = await ChatService.chat({ model: 'gpt-5', apiMode: 'responses', stream: true }, [{ role: 'user', content: 'hi' }])
    assert.equal(res.status, 'incomplete')
    assert.equal(res.incompleteReason, 'max_output_tokens')
    assert.equal(res.content, 'Half ')
    assert.equal(res.toolCalls[0].argumentsJson, '')
  } finally { global.fetch = original }

  global.fetch = async () => new Response(
    'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_2","type":"function_call","call_id":"call_2","name":"list_dir","arguments":""}}\n\n'
  )
  try {
    const res = await ChatService.chat({ model: 'gpt-5', apiMode: 'responses', stream: true }, [{ role: 'user', content: 'hi' }])
    assert.equal(res.status, 'truncated_stream')
  } finally { global.fetch = original }
})
