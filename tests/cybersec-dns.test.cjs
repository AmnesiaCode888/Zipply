const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const dns = require('node:dns/promises')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

const { CyberSecDns } = load('src/main/agent/plugins/cybersec/Dns.ts')
const { Blackboard } = load('src/main/agent/core/Blackboard.ts')

test('DNS inspector validates one hostname and a bounded subset of record types', () => {
  const tool = new CyberSecDns()
  assert.equal(tool.validate(JSON.stringify({ host: 'example.test', types: ['A', 'MX'] })), null)
  for (const args of [
    { host: 'https://example.test', types: ['A'] },
    { host: 'example.test/path', types: ['A'] },
    { host: '127.0.0.1', types: ['A'] },
    { host: 'example.test', types: [] },
    { host: 'example.test', types: ['A', 'BOGUS'] },
    { host: 'example.test', types: ['A', 'A'] },
    { host: 'example.test', types: ['A'], extra: true }
  ]) assert.notEqual(tool.validate(JSON.stringify(args)), null, JSON.stringify(args))
})

test('DNS inspector requires target approval before querying selected record types', async () => {
  const tool = new CyberSecDns()
  const originalA = dns.Resolver.prototype.resolve4, originalMx = dns.Resolver.prototype.resolveMx
  let calls = 0
  dns.Resolver.prototype.resolve4 = async () => { calls++; return [{ address: '203.0.113.8', ttl: 42 }] }
  dns.Resolver.prototype.resolveMx = async () => { calls++; return [{ exchange: 'mail.example.test', priority: 10 }] }
  try {
    const board = new Blackboard()
    let action
    board.setArtifact('config', { confirmAction: async value => { action = value; return false } })
    const args = JSON.stringify({ host: 'example.test', types: ['A', 'MX'] })
    const denied = await tool.execute(args, board)
    assert.equal(denied.error, true)
    assert.equal(action.kind, 'network')
    assert.equal(action.target, 'example.test')
    assert.equal(calls, 0)

    board.setArtifact('config', { confirmAction: async () => true })
    const result = await tool.execute(args, board)
    assert.equal(result.success, true)
    assert.equal(calls, 2)
    assert.deepEqual(result.data.records.A, [{ address: '203.0.113.8', ttl: 42 }])
    assert.deepEqual(result.data.records.MX, [{ exchange: 'mail.example.test', priority: 10 }])
  } finally { dns.Resolver.prototype.resolve4 = originalA; dns.Resolver.prototype.resolveMx = originalMx }
})

test('DNS inspector does not leak query details and caps oversized answers', async () => {
  const tool = new CyberSecDns()
  const originalTxt = dns.Resolver.prototype.resolveTxt
  dns.Resolver.prototype.resolveTxt = async () => Array.from({ length: 80 }, (_, index) => [`record-${index}-${'x'.repeat(900)}`])
  try {
    const board = new Blackboard()
    board.setArtifact('config', { confirmAction: async () => true })
    const result = await tool.execute(JSON.stringify({ host: 'example.test', types: ['TXT'] }), board)
    assert.equal(result.success, true)
    assert.equal(result.data.records.TXT.length, 10)
    assert.ok(result.data.truncated.includes('TXT'))
    assert.ok(result.data.records.TXT.every(value => value.length <= 512))
    assert.match(result.formattedContent, /ответ ограничен/)
  } finally { dns.Resolver.prototype.resolveTxt = originalTxt }
})

test('DNS inspector returns cancellation without querying when already aborted', async () => {
  const tool = new CyberSecDns()
  const controller = new AbortController(); controller.abort()
  const board = new Blackboard()
  board.setArtifact('config', { confirmAction: async () => { throw new Error('should not ask') } })
  const result = await tool.execute(JSON.stringify({ host: 'example.test', types: ['A'] }), board, controller.signal)
  assert.equal(result.error, true)
  assert.match(result.formattedContent, /отмен/i)
})
