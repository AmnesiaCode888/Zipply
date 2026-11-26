const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
function load(file) { const out = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' }); const m = new Module(path.resolve(file), module); m.filename = path.resolve(file); m.paths = module.paths; m._compile(out.outputFiles[0].text, m.filename); return m.exports }

test('search finds title and visible messages without searching hidden tool content', () => {
  const { searchChats } = load('src/renderer/src/services/chatSearch.ts')
  const chats = [{ id: 'a', title: 'Первый чат', messages: [{ id: 'u', role: 'user', content: 'Нужна ПОМОЩЬ' }, { id: 'a1', role: 'assistant', blocks: [{ id: 't', type: 'text', content: 'Ответ про React' }, { id: 'tool', type: 'tool', tool: { content: 'secret' } }] }] }, { id: 'b', title: 'React', messages: [] }]
  assert.deepEqual(searchChats(chats, 'react').map(r => [r.chatId, r.messageId]), [['a', 'a1'], ['b', undefined]])
  assert.equal(searchChats(chats, 'помощь')[0].messageId, 'u')
  assert.deepEqual(searchChats(chats, 'secret'), [])
  assert.deepEqual(searchChats(chats, '  '), [])
})

test('agent reports estimated context and records compaction in the response', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts')
  const { applyEventsToMessages } = load('src/renderer/src/hooks/useChat.ts')
  const original = global.fetch; let calls = 0
  global.fetch = async () => Response.json({ choices: [{ message: { content: ++calls === 1 ? 'summary' : 'done' } }] })
  const events = []
  try {
    await AgentRunner.run({ id: 'zipply', getTools: () => [], getHandler: () => undefined }, [{ role: 'user', content: 'old' }, { role: 'assistant', content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'read_file', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'x', content: 'a'.repeat(15000) }, { role: 'user', content: 'latest' }], { stream: false, contextLength: 4000 }, e => events.push(e))
    const status = events.find(e => e.type === 'context_status')
    assert.ok(status && status.estimatedTokens > 0 && status.limit === 4000 && status.compacted)
    const messages = applyEventsToMessages([{ id: 'a', role: 'assistant', blocks: [] }], events)
    assert.equal(messages[0].contextStatus.compacted, true)
    assert.equal(messages[0].contextStatus.limit, 4000)
  } finally { global.fetch = original }
})
