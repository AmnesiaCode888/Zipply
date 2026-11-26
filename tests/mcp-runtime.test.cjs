const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setTimeout: delay } = require('node:timers/promises')
const { createServer } = require('node:http')
const { existsSync } = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

let Runtime
function manager(options) {
  const filename = path.resolve('src/main/agent/mcp/McpRuntimeManager.ts')
  assert.ok(existsSync(filename), 'MCP manager module must exist')
  if (!Runtime) {
    const { outputFiles } = buildSync({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
    const mod = new Module(filename, module)
    mod.paths = module.paths
    mod._compile(outputFiles[0].text, filename)
    Runtime = mod.exports.McpRuntimeManager
  }
  return new Runtime(options)
}

// The fixture speaks newline-delimited JSON-RPC and exits on stdin EOF.
function legacyServer() {
  const lines = require('node:readline').createInterface({ input: process.stdin })
  let name = 'echo.value'
  const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  lines.on('line', line => {
    const { id, method, params } = JSON.parse(line)
    if (id === undefined) return
    let result
    switch (method) {
      case 'initialize':
        result = { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true }, resources: {}, prompts: {} }, serverInfo: { name: 'fixture', version: '1' } }
        break
      case 'tools/list':
        result = { tools: [{ name, inputSchema: { type: 'object', properties: { value: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] }, alias: { $ref: '#/$defs/alias' } }, required: ['value'], additionalProperties: false, $defs: { alias: { type: 'string' } } }, annotations: { readOnlyHint: true } }] }
        break
      case 'resources/list': result = { resources: [{ uri: 'test://info', name: 'info' }] }; break
      case 'prompts/list': result = { prompts: [{ name: 'greet' }] }; break
      case 'resources/read': result = { contents: [{ uri: params.uri, text: 'sample' }] }; break
      case 'prompts/get': result = { messages: [{ role: 'user', content: { type: 'text', text: params.arguments.who } }] }; break
      case 'tools/call': {
        if (params.name !== name) return send({ id, error: { code: -32602, message: 'wrong name' } })
        const value = params.arguments.value
        if (value === 'hang') return
        if (value === 'exit') return process.exit(0)
        if (value === 'rename') {
          name = 'new_name'
          send({ method: 'notifications/tools/list_changed' })
        }
        result = { content: [{ type: 'text', text: value === 'large' ? '界'.repeat(90000) : value === 'pid' ? String(process.pid) : value }] }
        break
      }
      default: return send({ id, error: { code: -32601, message: 'unknown method' } })
    }
    send({ id, result })
  })
}

function stdio(id) {
  return { id, transport: 'stdio', command: process.execPath, args: ['-e', '(' + legacyServer.toString() + ')()'] }
}

async function eventually(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return
    await delay(10)
  }
  assert.ok(predicate(), 'expected a state transition')
}

test('validates configuration before spawning or retaining sensitive fields', () => {
  const m = manager()
  for (const bad of [
    { ...stdio(''), command: 'node' }, { ...stdio('cmd'), command: ' ' },
    { ...stdio('args'), args: [42] }, { ...stdio('env'), env: { TOKEN: 'secret' } },
    { id: 'url', transport: 'http', url: 'file:///tmp/endpoint' },
    { id: 'user', transport: 'http', url: 'https://user:pass@example.com/mcp' },
    { id: 'header', transport: 'http', url: 'https://example.com', headers: { Authorization: 'secret' } }
  ]) assert.throws(() => m.registerServer(bad))
  assert.deepEqual(m.listServers(), [])
  m.registerServer(stdio('ok'))
  assert.throws(() => m.registerServer(stdio('ok')))
  assert.equal(m.getStatus('ok').state, 'disconnected')
})

test('negotiates legacy stdio, isolates catalogs, passes arguments, and refreshes on list change', async t => {
  const m = manager()
  t.after(() => m.dispose())
  for (const id of ['one', 'two']) m.registerServer(stdio(id))
  await Promise.all(['one', 'two'].map(id => m.connect(id)))
  const [tool] = m.listTools('one')
  assert.match(tool.id, /^[a-zA-Z0-9_-]{1,64}$/)
  assert.notEqual(tool.id, m.listTools('two')[0].id)
  assert.equal(tool.remoteName, 'echo.value')
  assert.equal(tool.inputSchema.properties.value.oneOf[1].items.properties.text.type, 'string')
  assert.deepEqual(tool.inputSchema.properties.value.oneOf[1].items.required, ['text'])
  assert.equal(tool.inputSchema.properties.alias.$ref, '#/$defs/alias')
  assert.equal(tool.inputSchema.additionalProperties, false)
  assert.deepEqual([tool.mutates, tool.parallelSafe, tool.cacheable], [true, false, false])
  assert.equal(m.getStatus('one').protocolVersion, '2025-11-25')
  assert.equal(m.listResources('one')[0].uri, 'test://info')
  assert.equal(m.listPrompts('one')[0].name, 'greet')
  assert.equal((await m.readResource('one', 'test://info')).contents[0].text, 'sample')
  assert.equal((await m.getPrompt('one', 'greet', { who: 'reader' })).messages[0].content.text, 'reader')
  assert.equal((await m.callTool(tool.id, { value: 'hello' })).content[0].text, 'hello')
  const revision = m.getStatus('one').revision
  await m.callTool(tool.id, { value: 'rename' })
  await eventually(() => m.listTools('one')[0]?.remoteName === 'new_name')
  assert.ok(m.getStatus('one').revision > revision)
  await assert.rejects(m.callTool(tool.id, { value: 'stale' }))
  assert.equal(m.listTools('two')[0].remoteName, 'echo.value')
})

test('a removed and re-registered server cannot receive calls from its old approval', async t => {
  const m = manager()
  t.after(() => m.dispose())
  m.registerServer(stdio('replace'))
  await m.connect('replace')
  const [{ id: toolId }] = m.listTools('replace')
  const originalInstance = m.getServerInstanceId('replace')

  await m.removeServer('replace')
  m.registerServer(stdio('replace'))
  await m.connect('replace')
  assert.notEqual(m.getServerInstanceId('replace'), originalInstance)
  await assert.rejects(m.callTool(toolId, { value: 'must-not-run' }, undefined, originalInstance), /configuration changed/)
})

test('caps UTF-8 result bytes, propagates abort, and reaps the session child on disconnect', async t => {
  const m = manager()
  t.after(() => m.dispose())
  m.registerServer(stdio('test'))
  await m.connect('test')
  const [{ id }] = m.listTools()
  const pid = Number((await m.callTool(id, { value: 'pid' })).content[0].text)
  await assert.rejects(m.callTool(id, { value: 'large' }), /256 KiB/)
  const controller = new AbortController()
  const waiting = m.callTool(id, { value: 'hang' }, controller.signal)
  controller.abort()
  await assert.rejects(waiting)
  const rejected = assert.rejects(m.callTool(id, { value: 'hang' }))
  await m.disconnect('test')
  await rejected
  assert.equal(m.getStatus('test').state, 'disconnected')
  assert.deepEqual(m.listTools(), [])
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('unexpected process exit invalidates tools and allows a fresh connection', async t => {
  const m = manager()
  t.after(() => m.dispose())
  m.registerServer(stdio('test'))
  await m.connect('test')
  const [{ id }] = m.listTools()
  await assert.rejects(m.callTool(id, { value: 'exit' }))
  await eventually(() => m.getStatus('test').state === 'error')
  assert.deepEqual(m.listTools(), [])
  await m.connect('test')
  assert.equal(m.listTools()[0].id, id)
})

test('a cancelled second connect caller releases only its wait; dispose cancels pending credentials', async () => {
  let started
  let finish
  const requested = new Promise(resolve => { started = resolve })
  const headers = new Promise(resolve => { finish = resolve })
  const m = manager({ getHeaders: () => { started(); return headers } })
  m.registerServer({ id: 'pending', transport: 'http', url: 'http://127.0.0.1/mcp' })
  const open = m.connect('pending')
  const settled = assert.rejects(open)
  await requested
  try {
    const controller = new AbortController()
    const waiting = assert.rejects(m.connect('pending', controller.signal))
    controller.abort()
    assert.equal(await Promise.race([waiting.then(() => 'aborted'), delay(150, 'timeout')]), 'aborted')
    assert.equal(m.getStatus('pending').state, 'connecting')
    assert.equal(await Promise.race([m.dispose().then(() => 'closed'), delay(150, 'timeout')]), 'closed')
    await settled
  } finally {
    const closing = m.dispose()
    finish({})
    await closing
    await settled
  }
})

test('negotiates modern Streamable HTTP with injected credentials and no legacy initialize', async t => {
  const methods = []
  const auth = []
  const http = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return }
    let body = ''
    for await (const chunk of req) body += chunk
    const { id, method } = JSON.parse(body)
    methods.push(method)
    auth.push(req.headers.authorization)
    const result = method === 'server/discover'
      ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
      : { resultType: 'complete', ttlMs: 0, cacheScope: 'private', tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id, result }))
  })
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => http.close(resolve)))
  const m = manager({ getHeaders: () => ({ Authorization: 'Bearer fixture' }) })
  t.after(() => m.dispose())
  m.registerServer({ id: 'modern', transport: 'http', url: 'http://127.0.0.1:' + http.address().port + '/mcp' })
  await m.connect('modern')
  assert.equal(m.getStatus('modern').protocolVersion, '2026-07-28')
  assert.equal(m.listTools()[0].remoteName, 'echo')
  assert.ok(methods.includes('server/discover'))
  assert.ok(!methods.includes('initialize'))
  assert.ok(auth.every(value => value === 'Bearer fixture'))
  assert.ok(!JSON.stringify(m.listServers()).includes('Bearer'))
})
