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
test('web reader reports source metadata and resolves links', async () => {
  const { WebTool } = load('src/main/agent/tools/WebTool.ts')
  const original = global.fetch
  global.fetch = async () => { const r = new Response('<html><title>Example</title><main><h1>Heading</h1><a href="/other">Link</a></main></html>', { headers: { 'content-type': 'text/html' } }); Object.defineProperty(r, 'url', { value: 'https://example.com/final' }); return r }
  try { const result = await new WebTool().execute(JSON.stringify({ url: 'https://example.com/start' }), {}); assert.match(result.formattedContent, /Example/); assert.match(result.formattedContent, /https:\/\/example.com\/other/); assert.match(result.formattedContent, /https:\/\/example.com\/final/) } finally { global.fetch = original }
})
test('web reader rejects PDF responses', async () => {
  const { WebTool } = load('src/main/agent/tools/WebTool.ts'); const original = global.fetch
  global.fetch = async () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } })
  try { const result = await new WebTool().execute(JSON.stringify({ url: 'https://example.com/a.pdf' }), {}); assert.equal(result.error, true) } finally { global.fetch = original }
})
test('async compaction keeps the latest turn and uses a summary', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'old '.repeat(1500) }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'latest question' }]
  const result = await ContextCompactor.compactAsync(messages, { contextLength: 1500, summarize: async () => 'Goal: old task' })
  assert.match(JSON.stringify(result), /Goal: old task/); assert.match(JSON.stringify(result), /latest question/); assert.equal(messages.length, 4)
})
test('async compaction fails instead of discarding history if summary fails', async () => {
  const { ContextCompactor } = load('src/main/agent/core/ContextCompactor.ts')
  const messages = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'old '.repeat(1500) }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'latest' }]
  await assert.rejects(() => ContextCompactor.compactAsync(messages, { contextLength: 1500, summarize: async () => { throw Error('offline') } }), /резюм/i)
})
test('external paths require confirmation even for reads', async () => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const board = new Blackboard(); let asked = false; let executed = false
  board.setArtifact('config', { workspacePath: process.cwd(), accessMode: 'automatic', confirmAction: async action => { asked = true; assert.equal(action.target, path.resolve('..')); return false } })
  const tool = { name: 'list_dir', validate: () => null, getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: true }), execute: async () => { executed = true; return { formattedContent: 'ok' } } }
  const messages = []; await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: '1', name: 'list_dir', argumentsJson: JSON.stringify({ path: '..' }) }], messages, board, () => {})
  assert.equal(asked, true); assert.equal(executed, false)
})
test('external symlink is resolved before approval', async (t) => {
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts'); const { Blackboard } = load('src/main/agent/core/Blackboard.ts')
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-path-')); const root = path.join(base, 'root'); const outside = path.join(base, 'outside')
  await fs.mkdir(root); await fs.mkdir(outside)
  let target; const board = new Blackboard(); board.setArtifact('config', { workspacePath: root, accessMode: 'automatic', confirmAction: async action => { target = action.target; return false } })
  const tool = { name: 'list_dir', validate: () => null, getExecutionPolicy: () => ({ mutates: false, cacheable: false }), execute: async () => { throw Error('should not execute') } }
  try {
    try { await fs.symlink(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir') }
    catch (err) { if (['EPERM', 'EACCES'].includes(err?.code)) { t.skip('junction/symlink not permitted in environment'); return } throw err }
    await ToolExecutor.executeCalls({ getHandler: () => tool }, [{ id: '1', name: 'list_dir', argumentsJson: '{"path":"link"}' }], [], board, () => {}); assert.equal(target, await fs.realpath(outside))
  } finally { await fs.rm(base, { recursive: true, force: true }) }
})
test('compacted history snapshot restores the conversation on the next turn', () => {
  const { buildAgentHistory } = load('src/renderer/src/services/agentHistory.ts')
  const snapshot = [{ role: 'user', content: 'summary' }, { role: 'user', content: 'latest' }]
  const result = buildAgentHistory([{ role: 'user', content: 'old' }, { role: 'assistant', agentHistory: [{ role: 'assistant', name: 'zipply_context_snapshot', content: JSON.stringify(snapshot) }, { role: 'assistant', content: 'answer' }] }, { role: 'user', content: 'next' }])
  assert.deepEqual(result.map(x => x.content), ['summary', 'latest', 'answer', 'next'])
})
test('agent stops after three identical failed tool calls and keeps their history', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts'); const original = global.fetch; let calls = 0
  global.fetch = async () => { calls++; return Response.json({ choices: [{ message: { tool_calls: [{ id: String(calls), type: 'function', function: { name: 'broken', arguments: '{}' } }] } }] }) }
  const tool = { name: 'broken', description: '', parameters: {}, validate: () => null, getExecutionPolicy: () => ({ mutates: false, cacheable: false, parallelSafe: true }), execute: async () => ({ formattedContent: 'bad', error: true }) }
  const events = []
  try { await AgentRunner.run({ id: 'zipply', getTools: () => [tool], getHandler: () => tool }, [{ role: 'user', content: 'do it' }], { stream: false }, e => events.push(e)); assert.equal(calls, 3); assert.match(events.at(-1).message, /трижды/); assert.equal(events.filter(e => e.type === 'history').at(-1).messages.filter(m => m.role === 'tool').length, 3) } finally { global.fetch = original }
})
test('agent loads project instructions into the system prompt', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts'); const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-rules-')); const original = global.fetch; let sent
  await fs.writeFile(path.join(dir, 'AGENTS.md'), 'PROJECT_RULE_42')
  global.fetch = async (_url, options) => { sent = JSON.parse(options.body); return Response.json({ choices: [{ message: { content: 'done' } }] }) }
  try { await AgentRunner.run({ id: 'zipply', getTools: () => [], getHandler: () => undefined }, [{ role: 'user', content: 'hello' }], { stream: false, workspacePath: dir }, () => {}); assert.match(JSON.stringify(sent.messages), /PROJECT_RULE_42/) } finally { global.fetch = original; await fs.rm(dir, { recursive: true, force: true }) }
})
test('provider context overflow triggers one summary and one retry', async () => {
  const { AgentRunner } = load('src/main/agent/core/AgentRunner.ts'); const original = global.fetch; let calls = 0; let lastBody
  global.fetch = async (_url, options) => {
    calls++; lastBody = JSON.parse(options.body)
    if (calls === 1) return new Response('maximum context length exceeded', { status: 400 })
    return Response.json({ choices: [{ message: { content: calls === 2 ? 'summary of prior work' : 'final answer' } }] })
  }
  const events = []
  try {
    await AgentRunner.run({ id: 'zipply', getTools: () => [], getHandler: () => undefined }, [{ role: 'user', content: 'old task' }, { role: 'assistant', content: 'old answer' }, { role: 'user', content: 'latest task' }], { stream: false, contextLength: 10000 }, e => events.push(e))
    assert.equal(calls, 3); assert.match(JSON.stringify(lastBody.messages), /summary of prior work/); assert.equal(events.at(-1).type, 'done')
  } finally { global.fetch = original }
})
test('page truncation is disclosed and empty pages fail', async () => {
  const { WebTool } = load('src/main/agent/tools/WebTool.ts'); const original = global.fetch
  try {
    global.fetch = async () => new Response(`<main>${'a'.repeat(26000)}</main>`, { headers: { 'content-type': 'text/html' } })
    const long = await new WebTool().execute('{"url":"https://example.com"}', {}); assert.equal(long.data.truncated, true); assert.match(long.formattedContent, /Усечено: да/)
    global.fetch = async () => new Response('<html><body><script>hidden</script></body></html>', { headers: { 'content-type': 'text/html' } })
    const empty = await new WebTool().execute('{"url":"https://example.com"}', {}); assert.equal(empty.error, true)
  } finally { global.fetch = original }
})
