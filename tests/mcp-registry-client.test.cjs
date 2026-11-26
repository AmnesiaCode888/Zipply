const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { test } = require('node:test')
const { buildSync } = require('esbuild')

const filename = path.resolve('src/main/agent/mcp/McpRegistryClient.ts')
const { outputFiles } = buildSync({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
const registryModule = new Module(filename, module)
registryModule.paths = module.paths
registryModule._compile(outputFiles[0].text, filename)
const { McpRegistryClient } = registryModule.exports

const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => String(Buffer.byteLength(JSON.stringify(body))) },
  text: async () => JSON.stringify(body)
})

const server = (name, endpoint, extra = {}) => ({
  server: {
    name,
    title: name.split('/').at(-1),
    description: 'A public MCP server',
    version: '1.2.3',
    remotes: [{ type: 'streamable-http', url: endpoint }],
    ...extra
  }
})

test('search returns only validated latest HTTPS Streamable HTTP servers and caches exact entries', async () => {
  let requests = 0
  const registry = new McpRegistryClient(async url => {
    requests++
    assert.equal(new URL(url).searchParams.get('version'), 'latest')
    return response({ servers: [
      server('com.example/docs', 'https://docs.example.test/mcp'),
      server('com.example/local', 'http://127.0.0.1:3000/mcp'),
      server('com.example/sse', 'https://sse.example.test/mcp', { remotes: [{ type: 'sse', url: 'https://sse.example.test/mcp' }] }),
      server('com.example/template', 'https://example.test/{token}'),
      { ...server('com.example/deleted', 'https://deleted.example.test/mcp'), status: 'deleted' }
    ] })
  })

  const result = await registry.search('docs')
  assert.deepEqual(result.map(item => item.serverName), ['com.example/docs'])
  assert.equal(result[0].endpoint, 'https://docs.example.test/mcp')
  assert.equal(registry.getCached('com.example/docs').endpoint, result[0].endpoint)
  await registry.search('docs')
  assert.equal(requests, 1)
})

test('rejects malformed responses, bad queries and oversized registry data', async () => {
  const malformed = new McpRegistryClient(async () => response({ servers: 'not-an-array' }))
  await assert.rejects(malformed.search('filesystem'), /registry|сервер|каталог/i)
  await assert.rejects(malformed.search('x'), /запрос|символ/i)

  const invalidEntry = new McpRegistryClient(async () => response({ servers: [{ server: { name: '../bad', remotes: [] } }] }))
  assert.deepEqual(await invalidEntry.search('filesystem'), [])

  const oversized = new McpRegistryClient(async () => ({
    ok: true, status: 200, headers: { get: () => String(2_000_000) },
    text: async () => { throw new Error('must not read oversized body') }
  }))
  await assert.rejects(oversized.search('filesystem'), /размер|лимит/i)
})

test('connection resolution refreshes the registry record and rejects a changed endpoint', async () => {
  let endpoint = 'https://one.example.test/mcp'
  const registry = new McpRegistryClient(async () => response({
    servers: [server('com.example/docs', endpoint)]
  }), { cacheTtlMs: 60_000 })
  const [listed] = await registry.search('docs')
  assert.equal(listed.endpoint, 'https://one.example.test/mcp')
  endpoint = 'https://two.example.test/mcp'
  await assert.rejects(registry.resolve('com.example/docs', listed.endpoint), /изменил|изменил адрес|повторно/i)
})

test('aborted registry requests stop before parsing the response', async () => {
  const controller = new AbortController()
  const registry = new McpRegistryClient((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    controller.abort()
  }))
  await assert.rejects(registry.search('filesystem', controller.signal), { name: 'AbortError' })
})
