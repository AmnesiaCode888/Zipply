const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

test('MCP adapter preserves schema, requires explicit approval and returns the server result', async () => {
  const { McpToolAdapter } = load('src/main/agent/mcp/McpToolAdapter.ts')
  const descriptor = {
    id: 'mcp_linear_search_abc123', serverId: 'linear', remoteName: 'search_issues', description: 'Search issues',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search text', minLength: 2 } }, required: ['query'] },
    mutates: true, parallelSafe: false, cacheable: false
  }
  let called
  const adapter = new McpToolAdapter('linear', descriptor, { getServerInstanceId: () => 'instance-1', callTool: async (...args) => { called = args; return { content: [{ type: 'text', text: 'found 2 issues' }] } } })
  assert.equal(adapter.name, descriptor.id)
  assert.equal(adapter.parameters.query.required, true)
  assert.equal(adapter.parameters.query.minLength, 2)
  assert.deepEqual(adapter.getExecutionPolicy(), { mutates: true, parallelSafe: false, cacheable: false })
  assert.deepEqual(adapter.getApprovalRequest({ query: 'timeout' }), {
    kind: 'mcp', command: 'linear · search_issues', target: 'linear', serverId: 'linear', toolId: descriptor.id, toolName: 'search_issues', details: '{\n  "query": "timeout"\n}'
  })
  assert.deepEqual(adapter.getDisplayInfo(), { label: 'MCP · search_issues', targetName: 'linear' })
  const result = await adapter.execute('{"query":"timeout"}', {}, undefined)
  assert.equal(result.formattedContent, 'found 2 issues')
  assert.deepEqual(called, [descriptor.id, { query: 'timeout' }, undefined, 'instance-1'])
})

test('MCP adapter refuses non-object arguments and surfaces a server error', async () => {
  const { McpToolAdapter } = load('src/main/agent/mcp/McpToolAdapter.ts')
  const descriptor = { id: 'mcp_test_tool_abc123', serverId: 'test', remoteName: 'tool', description: '', inputSchema: { type: 'object', properties: {} }, mutates: true, parallelSafe: false, cacheable: false }
  const adapter = new McpToolAdapter('test', descriptor, { getServerInstanceId: () => 'instance-1', callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'remote failure' }] }) })
  assert.equal((await adapter.execute('[]', {})).error, true)
  const result = await adapter.execute('{}', {})
  assert.equal(result.error, true)
  assert.equal(result.formattedContent, 'remote failure')
})

test('MCP structured output stays out of ToolResult internal control metadata', async () => {
  const { McpToolAdapter } = load('src/main/agent/mcp/McpToolAdapter.ts')
  const descriptor = { id: 'mcp_test_tool_abc123', serverId: 'test', remoteName: 'tool', description: '', inputSchema: { type: 'object', properties: {} }, mutates: true, parallelSafe: false, cacheable: false }
  const adapter = new McpToolAdapter('test', descriptor, { getServerInstanceId: () => 'instance-1', callTool: async () => ({
    structuredContent: { logPath: 'C:\\private\\secrets.txt', ok: true }, content: []
  }) })
  const result = await adapter.execute('{}', {})
  assert.equal('data' in result, false)
  assert.match(result.formattedContent, /private/)
})

test('MCP adapter binds approval to the server registration active when it was created', async () => {
  const { McpToolAdapter } = load('src/main/agent/mcp/McpToolAdapter.ts')
  const descriptor = { id: 'mcp_test_tool_abc123', serverId: 'test', remoteName: 'tool', description: '', inputSchema: { type: 'object', properties: {} }, mutates: true, parallelSafe: false, cacheable: false }
  let instance = 'original-instance'
  let called = false
  const runtime = {
    getServerInstanceId: () => instance,
    callTool: async (_id, _args, _abort, expected) => {
      if (expected !== instance) throw new Error('MCP server configuration changed while the tool was awaiting approval.')
      called = true
      return { content: [] }
    }
  }
  const adapter = new McpToolAdapter('test', descriptor, runtime)
  instance = 'replacement-instance'
  const result = await adapter.execute('{}', {})
  assert.equal(called, false)
  assert.equal(result.error, true)
  assert.match(result.formattedContent, /configuration changed/)
})

test('MCP tools preserve nested and advanced JSON Schema in provider declarations', () => {
  const { McpToolAdapter } = load('src/main/agent/mcp/McpToolAdapter.ts')
  const { ToolExecutor } = load('src/main/agent/core/ToolExecutor.ts')
  const schema = {
    type: 'object',
    properties: {
      filter: { oneOf: [
        { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] },
        { type: 'array', items: { type: 'object', properties: { tag: { type: 'string' } }, required: ['tag'] } }
      ] },
      aliases: { $ref: '#/$defs/aliases' }
    },
    required: ['filter'],
    additionalProperties: false,
    $defs: { aliases: { type: 'array', items: { type: 'string' } } }
  }
  const descriptor = { id: 'mcp_test_search_abc123', serverId: 'test', remoteName: 'search', description: 'Search', inputSchema: schema, mutates: true, parallelSafe: false, cacheable: false }
  const adapter = new McpToolAdapter('test', descriptor, { getServerInstanceId: () => 'instance-1', callTool: async () => ({ content: [] }) })
  const definitions = ToolExecutor.buildToolDefs({ getTools: () => [adapter] })
  assert.deepEqual(definitions[0].function.parameters, schema)
})
