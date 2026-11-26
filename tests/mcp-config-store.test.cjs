const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const { buildSync } = require('esbuild')

let Store
function loadStore() {
  if (!Store) {
    const filename = path.resolve('src/main/agent/mcp/McpConfigStore.ts')
    const { outputFiles } = buildSync({ entryPoints: [filename], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external' })
    const mod = new Module(filename, module)
    mod.paths = module.paths
    mod._compile(outputFiles[0].text, filename)
    Store = mod.exports.McpConfigStore
  }
  return Store
}

function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zipply-mcp-config-'))
  const values = new Map()
  const secretStore = options.secretStore || {
    get: key => values.get(key) || '',
    set: (key, value) => value ? values.set(key, value) : values.delete(key)
  }
  const store = new (loadStore())(root, secretStore, options)
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, store, values }
}

const stdio = (id, overrides = {}) => ({ id, transport: 'stdio', command: process.execPath, args: ['server.js'], ...overrides })
const http = (id, overrides = {}) => ({ id, transport: 'http', url: 'https://mcp.example.test/endpoint', ...overrides })

test('persists validated stdio and HTTP definitions without credentials', t => {
  const { root, store } = setup(t)
  store.add(stdio('repo-tools', { cwd: process.cwd() }))
  store.add(http('docs'))

  const reloaded = new (loadStore())(root, { get: () => '', set: () => {} })
  assert.deepEqual(reloaded.list().map(server => server.id), ['repo-tools', 'docs'])
  assert.deepEqual(reloaded.getDefinition('repo-tools'), stdio('repo-tools', { cwd: process.cwd() }))
  assert.equal(reloaded.getDefinition('docs').url, 'https://mcp.example.test/endpoint')
  assert.equal(fs.existsSync(path.join(root, 'mcp-servers.json')), true)
})

test('rejects shell command strings, unsafe identifiers, credentials, and undeclared fields', t => {
  const { store } = setup(t)
  for (const definition of [
    stdio('with-flags', { command: `${process.execPath} --version` }),
    stdio('shell-separator', { command: 'node; whoami' }),
    stdio('quoted', { command: '"node"' }),
    stdio('relative-cwd', { cwd: 'relative/path' }),
    stdio('../escape'),
    stdio('bad id'),
    stdio('extra', { env: { TOKEN: 'secret' } }),
    stdio('arg-secret', { args: ['--api-key', 'secret-value'] }),
    http('url-creds', { url: 'https://user:secret@mcp.example.test/mcp' }),
    http('url-token', { url: 'https://mcp.example.test/mcp?access_token=secret' }),
    http('header-field', { headers: { Authorization: 'Bearer secret' } })
  ]) assert.throws(() => store.add(definition))
  assert.deepEqual(store.list(), [])
})

test('keeps authentication headers in SecretStore and exposes only configured status', t => {
  const { root, store, values } = setup(t)
  store.add(http('private-api'))
  store.setAuthHeaders('private-api', { Authorization: 'Bearer hidden-token', 'X-Api-Key': 'hidden-key' })

  assert.deepEqual(store.getHeaders('private-api'), { Authorization: 'Bearer hidden-token', 'X-Api-Key': 'hidden-key' })
  assert.deepEqual(store.list()[0], { ...http('private-api'), authConfigured: true })
  const serializedConfig = fs.readFileSync(path.join(root, 'mcp-servers.json'), 'utf8')
  assert.doesNotMatch(serializedConfig, /hidden-token|hidden-key|Authorization|X-Api-Key/)
  assert.equal(values.size, 1)

  store.setAuthHeaders('private-api', {})
  assert.deepEqual(store.getHeaders('private-api'), {})
  assert.equal(store.list()[0].authConfigured, false)
  assert.equal(values.size, 0)
})

test('creates an HTTP server and its authorization secret as one transaction', t => {
  const { root, store } = setup(t)
  const configured = store.add({ id: 'linear', transport: 'http', url: 'https://example.com/mcp' }, { Authorization: 'Bearer secret' })
  assert.equal(configured.authConfigured, true)
  assert.equal(store.list()[0].authConfigured, true)
  assert.deepEqual(store.getHeaders('linear'), { Authorization: 'Bearer secret' })
  assert.equal(JSON.stringify(store.list()).includes('Bearer secret'), false)

  const failingSecrets = { get: () => '', set: () => { throw new Error('vault unavailable') } }
  const failingStore = new (loadStore())(path.join(root, 'failed'), failingSecrets)
  assert.throws(() => failingStore.add({ id: 'failed', transport: 'http', url: 'https://example.com/mcp' }, { Authorization: 'Bearer secret' }), /vault unavailable/)
  assert.deepEqual(failingStore.list(), [])
})

test('validates header syntax and refuses to configure secrets without SecretStore', t => {
  const { store } = setup(t)
  store.add(http('headers'))
  for (const headers of [
    { 'Bad Header': 'value' },
    { Authorization: 'bad\r\nInjected: yes' },
    { Authorization: 'Bearer first', authorization: 'Bearer second' },
    { Host: 'override.example.test' },
    Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`X-Header-${index}`, 'value']))
  ]) assert.throws(() => store.setAuthHeaders('headers', headers))
  assert.throws(() => new (loadStore())(path.join(os.tmpdir(), 'unused'), undefined).setAuthHeaders('headers', { Authorization: 'secret' }))
})

test('enforces unique bounded server records and removes credentials with a removed server', t => {
  const { store, values } = setup(t, { maxServers: 2 })
  store.add(http('one'))
  assert.throws(() => store.add(http('one')), /уже существует/)
  store.add(stdio('two'))
  assert.throws(() => store.add(stdio('three')), /лимит/)
  store.setAuthHeaders('one', { Authorization: 'Bearer secret' })
  assert.equal(store.remove('one'), true)
  assert.equal(store.remove('one'), false)
  assert.equal(values.size, 0)
  assert.deepEqual(store.list().map(server => server.id), ['two'])
})
