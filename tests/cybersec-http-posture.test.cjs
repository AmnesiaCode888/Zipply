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

const { CyberSecHttpPosture } = load('src/main/agent/plugins/cybersec/HttpPosture.ts')
const { Blackboard } = load('src/main/agent/core/Blackboard.ts')

function response(status, headers = {}) {
  return {
    status,
    headers: {
      get: name => headers[name.toLowerCase()] ?? null,
      getSetCookie: () => headers['set-cookie'] ? [headers['set-cookie']] : []
    },
    body: { cancel: async () => {} }
  }
}

test('HTTP posture stops before cross-origin redirect and exposes no response body', async () => {
  const original = global.fetch
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    return response(302, { location: 'https://other.example/private?token=should-not-leak' })
  }
  try {
    let approval
    const board = new Blackboard()
    board.setArtifact('config', { confirmAction: async action => { approval = action; return true } })
    const tool = new CyberSecHttpPosture()
    assert.equal(tool.validate(JSON.stringify({ url: 'https://example.test/?token=x' })) !== null, true)
    const result = await tool.execute(JSON.stringify({ url: 'https://example.test/' }), board)
    assert.equal(approval.kind, 'network')
    assert.equal(approval.target, 'https://example.test/')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].options.method, 'GET')
    assert.equal(calls[0].options.redirect, 'manual')
    assert.equal(result.success, true)
    assert.equal(result.data.redirects.length, 1)
    assert.equal(result.data.redirects[0].followed, false)
    assert.match(result.formattedContent, /другой домен/i)
    assert.doesNotMatch(JSON.stringify(result), /should-not-leak/)
  } finally { global.fetch = original }
})

test('HTTP posture follows same-origin redirects, reports cookie flags, and redacts cookie values', async () => {
  const original = global.fetch
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options })
    if (calls.length === 1) return response(302, { location: '/final', 'set-cookie': 'session=super-secret; Path=/; HttpOnly; SameSite=Strict' })
    return response(200, { 'content-security-policy': "default-src 'self'", 'set-cookie': 'prefs=hidden-value; Secure; SameSite=Lax' })
  }
  try {
    const board = new Blackboard()
    board.setArtifact('config', { confirmAction: async () => true })
    const result = await new CyberSecHttpPosture().execute(JSON.stringify({ url: 'https://example.test/start' }), board)
    assert.equal(calls.length, 2)
    assert.equal(calls[1].url, 'https://example.test/final')
    assert.equal(result.data.status, 200)
    assert.equal(result.data.cookies.length, 2)
    assert.match(JSON.stringify(result), /session/)
    assert.match(JSON.stringify(result), /HttpOnly/)
    assert.doesNotMatch(JSON.stringify(result), /super-secret|hidden-value/)
    assert.equal(result.data.body, undefined)
  } finally { global.fetch = original }
})
