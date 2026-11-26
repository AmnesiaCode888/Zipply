const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

test('MCP trust is scoped to one server and tool and can be revoked', () => {
  const { McpTrustStore } = load('src/main/agent/mcp/McpTrustStore.ts')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-mcp-trust-'))
  try {
    const store = new McpTrustStore(root)
    assert.equal(store.isTrusted('linear', 'mcp_linear_search_abc123'), false)
    store.trust('linear', 'mcp_linear_search_abc123', 'search')
    store.trust('linear', 'mcp_linear_list_abc123', 'list')
    assert.equal(store.isTrusted('linear', 'mcp_linear_search_abc123'), true)
    assert.equal(store.isTrusted('github', 'mcp_linear_search_abc123'), false)
    assert.equal(store.list().length, 2)
    store.revoke('linear', 'mcp_linear_search_abc123')
    assert.equal(store.isTrusted('linear', 'mcp_linear_search_abc123'), false)
    store.revokeServer('linear')
    assert.equal(store.list().length, 0)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('MCP trust refuses malformed identifiers and fails closed on corrupt persistence', () => {
  const { McpTrustStore } = load('src/main/agent/mcp/McpTrustStore.ts')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-mcp-trust-'))
  try {
    const store = new McpTrustStore(root)
    assert.throws(() => store.trust('linear', '../tool', 'bad'))
    fs.writeFileSync(path.join(root, 'mcp-trust.json'), '{broken')
    assert.throws(() => store.isTrusted('linear', 'tool'))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
