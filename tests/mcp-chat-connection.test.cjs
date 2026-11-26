const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { buildSync } = require('esbuild')

const filename = path.join(__dirname, 'mcp-chat-connection.bundle.cjs')
const { outputFiles } = buildSync({
  stdin: {
    contents: `
      export { runAgent, AgentRunner, Blackboard, ToolExecutor } from '../src/main/agent/index'
      export { McpConfigStore } from '../src/main/agent/mcp/McpConfigStore'
      export { McpConnectionService } from '../src/main/agent/mcp/McpConnectionService'
      export { McpRuntimeManager } from '../src/main/agent/mcp/McpRuntimeManager'
    `,
    resolveDir: __dirname
  },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false
})
const bundle = new Module(filename, module)
bundle.paths = module.paths
bundle._compile(outputFiles[0].text, filename)
const { runAgent, AgentRunner, Blackboard, ToolExecutor, McpConfigStore, McpConnectionService, McpRuntimeManager } = bundle.exports

async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zipply-mcp-chat-'))
  const config = new McpConfigStore(directory)
  const calls = []
  const mcp = new McpRuntimeManager({
    getHeaders: id => config.getHeaders(id),
    createConnection: (definition, _options, headers) => {
      calls.push({ definition, headers })
      const schema = { type: 'object', properties: { question: { type: 'string' } } }
      const transport = { close: async () => {} }
      return { transport, client: {
        transport,
        connect: options.connect ?? (async () => {}),
        close: async () => {},
        getServerCapabilities: () => ({ tools: {} }),
        listTools: async () => ({ tools: ['ask_question', 'read_structure'].map(name => ({ name, inputSchema: schema })) }),
        getNegotiatedProtocolVersion: () => '2025-11-25',
        callTool: async ({ name }) => ({ content: [{ type: 'text', text: name }] })
      } }
    }
  })
  const connections = new McpConnectionService(config, mcp)
  t.after(async () => {
    await mcp.dispose()
    await fs.rm(directory, { recursive: true, force: true })
  })

  let onRun
  t.mock.method(AgentRunner, 'run', async (agent, _history, settings) => onRun(agent, settings))
  const withChat = async (sessionId, callback, confirmAction = async () => true) => {
    onRun = callback
    await runAgent('zipply', [], { accessMode: 'unrestricted', confirmAction }, () => {}, undefined, [], {
      sessionId, mcp, mcpConnections: connections, skills: { discover: async () => [] }
    })
  }
  return { config, calls, mcp, connections, withChat }
}

async function invoke(agent, settings, name, args) {
  const board = new Blackboard()
  board.setArtifact('config', settings)
  const messages = []
  await ToolExecutor.executeCalls(agent, [{ id: 'call', name, argumentsJson: JSON.stringify(args) }], messages, board, () => {})
  return messages.at(-1).content
}

test('chat approval connects the catalog server and loads only the requested schema', async t => {
  const { config, calls, mcp, withChat } = await fixture(t)
  const approvals = []
  const approve = async action => { approvals.push(action); return true }
  const connect = { action: 'connect', serverId: 'deepwiki' }
  let toolId

  await withChat('original-chat', async (agent, settings) => {
    assert.match(await invoke(agent, settings, 'manage_mcp', connect), /подключён/i)
    const tools = mcp.listTools('deepwiki')
    toolId = tools[0].id
    const names = () => ToolExecutor.buildToolDefs(agent).map(tool => tool.function.name)
    assert.ok(tools.every(tool => !names().includes(tool.id)))
    assert.match(await invoke(agent, settings, 'search_tools', { query: 'ask_question' }), new RegExp(toolId))
    assert.match(await invoke(agent, settings, 'manage_mcp', { action: 'load', serverId: 'deepwiki', toolId }), /доступен/)
    assert.ok(names().includes(toolId))
    assert.ok(!names().includes(tools[1].id))
    assert.match(await invoke(agent, settings, toolId, { question: 'Where is the README?' }), /ask_question/)
  }, approve)

  assert.equal(calls.length, 1)
  assert.equal(calls[0].definition.url, 'https://mcp.deepwiki.com/mcp')
  assert.deepEqual(calls[0].headers, {})
  assert.equal(config.list().length, 1)
  assert.deepEqual(approvals.map(action => action.kind), ['mcp_connection', 'mcp'])

  await withChat('other-chat', async (agent, settings) => {
    assert.match(await invoke(agent, settings, 'manage_mcp', { action: 'load', serverId: 'deepwiki', toolId }), /отсутствует/)
  })
  await withChat('original-chat', async (agent, settings) => {
    assert.match(await invoke(agent, settings, 'manage_mcp', { action: 'load', serverId: 'deepwiki', toolId }), /доступен/)
    await mcp.disconnect('deepwiki')
    assert.equal(agent.getHandler(toolId), undefined)
  })
})

test('refusal, read-only mode and a caller-supplied URL cannot start a connection', async t => {
  const { config, calls, withChat } = await fixture(t)
  const args = { action: 'connect', serverId: 'deepwiki' }
  let approvals = 0
  await withChat('chat', async (agent, settings) => {
    assert.match(await invoke(agent, settings, 'manage_mcp', { ...args, url: 'https://example.invalid/mcp' }), /параметры/)
    assert.match(await invoke(agent, { ...settings, accessMode: 'read-only' }, 'manage_mcp', args), /только для чтения/)
    assert.equal(approvals, 0)
    assert.match(await invoke(agent, settings, 'manage_mcp', args), /отклонено или отменено/)
  }, async () => { approvals++; return false })
  assert.equal(approvals, 1)
  assert.deepEqual(calls, [])
  assert.deepEqual(config.list(), [])
})

test('cancelling a connection discards a new registration and allows a retry', async t => {
  const controller = new AbortController()
  let attempts = 0
  const { config, mcp, connections } = await fixture(t, { connect: async () => {
    if (++attempts === 1) controller.abort()
  } })
  await assert.rejects(connections.connectCatalog('deepwiki', controller.signal), { name: 'AbortError' })
  assert.deepEqual(config.list(), [])
  assert.deepEqual(mcp.listServers(), [])
  assert.equal((await connections.connectCatalog('deepwiki')).state, 'connected')
})
