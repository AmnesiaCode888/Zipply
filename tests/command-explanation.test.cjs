const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const Module = require('node:module')
const path = require('node:path')

function load(file) {
  const result = buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, packages: 'external' })
  const mod = new Module(path.resolve(file), module)
  mod.filename = path.resolve(file)
  mod.paths = module.paths
  mod._compile(result.outputFiles[0].text, mod.filename)
  return mod.exports
}

test('explains the pending command with the configured model without tools', async () => {
  const { explainCommand } = load('src/main/agent/services/CommandExplanation.ts')
  const originalFetch = global.fetch
  let request
  global.fetch = async (url, options) => {
    request = { url, ...options, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Отправляет запрос.' } }] }), { status: 200 })
  }
  try {
    const result = await explainCommand('curl -X POST https://example.com', { apiKey: 'key', model: 'example/model', baseUrl: 'https://provider.example/v1' })
    assert.equal(result, 'Отправляет запрос.')
    assert.equal(request.body.model, 'example/model')
    assert.equal(request.body.stream, false)
    assert.equal(request.body.tools, undefined)
    assert.match(request.body.messages[1].content, /curl -X POST/)
    assert.match(request.body.messages[0].content, /инструкц/i)
  } finally { global.fetch = originalFetch }
})

test('reports an empty model response', async () => {
  const { explainCommand } = load('src/main/agent/services/CommandExplanation.ts')
  const originalFetch = global.fetch
  global.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 })
  try {
    await assert.rejects(explainCommand('git push', { apiKey: 'key' }), /пустой ответ/i)
  } finally { global.fetch = originalFetch }
})
