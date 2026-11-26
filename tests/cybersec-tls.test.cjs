const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')
const dns = require('node:dns/promises')
const tls = require('node:tls')
const { EventEmitter } = require('node:events')

function load(file) {
  const filename = path.resolve(file)
  const result = buildSync({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const mod = new Module(filename, module); mod.filename = filename; mod.paths = module.paths; mod._compile(result.outputFiles[0].text, filename); return mod.exports
}

const { CyberSecTls } = load('src/main/agent/plugins/cybersec/Tls.ts')
const { Blackboard } = load('src/main/agent/core/Blackboard.ts')

function fakeSocket({ authorized = true, authorizationError, peer } = {}) {
  const socket = new EventEmitter()
  socket.destroy = () => socket
  socket.getPeerCertificate = () => peer || ({ subject: { CN: 'service.example.test' }, issuer: { CN: 'Example CA' }, subjectaltname: 'DNS:service.example.test', valid_from: 'Jan  1 00:00:00 2026 GMT', valid_to: 'Jan  1 00:00:00 2027 GMT', fingerprint256: 'AA:BB' })
  socket.getProtocol = () => 'TLSv1.3'
  socket.authorized = authorized
  socket.authorizationError = authorizationError
  queueMicrotask(() => socket.emit('secureConnect'))
  return socket
}

test('TLS probe requires target approval before resolving and pins the IP while validating the hostname', async () => {
  const originalLookup = dns.lookup
  const originalConnect = tls.connect
  const calls = []
  dns.lookup = async host => { calls.push(['dns', host]); return { address: '203.0.113.9', family: 4 } }
  tls.connect = options => { calls.push(['tls', options]); return fakeSocket() }
  try {
    const tool = new CyberSecTls()
    const board = new Blackboard()
    board.setArtifact('config', { confirmAction: async action => { calls.push(['approval', action]); return true } })
    const result = await tool.execute(JSON.stringify({ host: 'service.example.test' }), board)
    assert.equal(result.success, true)
    assert.deepEqual(calls.map(call => call[0]), ['approval', 'dns', 'tls'])
    assert.equal(calls[0][1].kind, 'network')
    assert.equal(calls[0][1].target, 'service.example.test:443')
    assert.equal(calls[1][1], 'service.example.test')
    assert.equal(calls[2][1].host, '203.0.113.9')
    assert.equal(calls[2][1].port, 443)
    assert.equal(calls[2][1].servername, 'service.example.test')
    assert.equal(calls[2][1].rejectUnauthorized, true)
    assert.equal(typeof calls[2][1].checkServerIdentity, 'function')
    assert.equal(result.data.address, '203.0.113.9')
    assert.equal(result.data.certificate.subject, 'CN=service.example.test')
    assert.equal(result.data.certificate.validTo, 'Jan  1 00:00:00 2027 GMT')
    assert.equal(result.data.protocol, 'TLSv1.3')
  } finally { dns.lookup = originalLookup; tls.connect = originalConnect }
})

test('TLS probe rejects invalid targets and does not connect after approval is declined', async () => {
  const originalLookup = dns.lookup
  const originalConnect = tls.connect
  let lookups = 0, connections = 0
  dns.lookup = async () => { lookups++; return { address: '203.0.113.9', family: 4 } }
  tls.connect = () => { connections++; return fakeSocket() }
  try {
    const tool = new CyberSecTls()
    assert.ok(tool.validate(JSON.stringify({ host: 'https://service.example.test' })))
    assert.ok(tool.validate(JSON.stringify({ host: '192.168.1.0/24' })))
    assert.ok(tool.validate(JSON.stringify({ host: 'service.example.test', port: 70000 })))
    assert.equal(tool.validate(JSON.stringify({ host: 'service.example.test' })), null)
    const board = new Blackboard(); board.setArtifact('config', { confirmAction: async () => false })
    const result = await tool.execute(JSON.stringify({ host: 'service.example.test' }), board)
    assert.equal(result.error, true)
    assert.equal(lookups, 0)
    assert.equal(connections, 0)
  } finally { dns.lookup = originalLookup; tls.connect = originalConnect }
})

test('TLS probe fails closed when the standard trust check rejects the peer certificate', async () => {
  const originalLookup = dns.lookup
  const originalConnect = tls.connect
  dns.lookup = async () => ({ address: '203.0.113.9', family: 4 })
  tls.connect = () => fakeSocket({ authorized: false, authorizationError: 'SELF_SIGNED_CERT_IN_CHAIN' })
  try {
    const tool = new CyberSecTls()
    const board = new Blackboard(); board.setArtifact('config', { confirmAction: async () => true })
    const result = await tool.execute(JSON.stringify({ host: 'service.example.test' }), board)
    assert.equal(result.error, true)
    assert.match(result.formattedContent, /сертификат|довер/i)
    assert.equal(result.data, undefined)
  } finally { dns.lookup = originalLookup; tls.connect = originalConnect }
})
